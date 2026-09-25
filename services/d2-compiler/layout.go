package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/d2lang/d2/d2graph"
	"github.com/d2lang/d2/d2layouts/d2dagrelayout"
	"github.com/d2lang/d2/d2layouts/d2elklayout"
	"github.com/d2lang/d2/d2layouts/d2talalayout"
	"github.com/d2lang/d2/d2lib"
	"github.com/d2lang/d2/d2themes"
	"github.com/d2lang/d2/d2themes/d2themescatalog"
	"github.com/d2lang/d2/lib/color"
	"github.com/d2lang/d2/lib/textmeasure"
)

type server struct {
	ruler          *textmeasure.Ruler
	sem            chan struct{}
	timeout        time.Duration
	maxSourceBytes int64
}

type nodeJSON struct {
	Key         string         `json:"key"`
	Label       string         `json:"label"`
	Detail      string         `json:"detail,omitempty"`
	X           float64        `json:"x"`
	Y           float64        `json:"y"`
	Width       float64        `json:"width"`
	Height      float64        `json:"height"`
	Shape       string         `json:"shape,omitempty"`
	Style       map[string]any `json:"style,omitempty"`
	StrokeWidth float64        `json:"strokeWidth,omitempty"`
}

type edgeJSON struct {
	Key    string `json:"key"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label,omitempty"`
	Color  string `json:"color,omitempty"`
}

type compileResponse struct {
	Nodes  []nodeJSON `json:"nodes"`
	Edges  []edgeJSON `json:"edges"`
	Engine string     `json:"engine"`
}

func dagreLayout() string { return "dagre" }
func elkLayout() string   { return "elk" }
func talaLayout() string  { return "tala" }

// supportedLayouts maps engine names to their bundled in-process layout
// implementations. All three ship inside the d2 module — no external
// binaries or network access required.
func supportedLayouts() map[string]d2graph.LayoutGraph {
	return map[string]d2graph.LayoutGraph{
		dagreLayout(): d2dagrelayout.DefaultLayout,
		elkLayout():   d2elklayout.DefaultLayout,
		talaLayout():  d2talalayout.DefaultLayout,
	}
}

func (s *server) handleCompile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "", "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.maxSourceBytes+4096)
	var req compileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "", "invalid JSON request body")
		return
	}
	engine := strings.ToLower(strings.TrimSpace(req.Engine))
	if engine == "" {
		engine = dagreLayout()
	}
	layout, ok := supportedLayouts()[engine]
	if !ok {
		writeError(w, http.StatusBadRequest, "INVALID_ENGINE",
			fmt.Sprintf("Unknown layout engine: %q (supported: dagre, elk, tala)", truncateEngine(req.Engine)))
		return
	}
	if strings.TrimSpace(req.Source) == "" {
		writeError(w, http.StatusBadRequest, "", "source must not be empty")
		return
	}
	if int64(len(req.Source)) > s.maxSourceBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "",
			fmt.Sprintf("source exceeds %d bytes", s.maxSourceBytes))
		return
	}

	select {
	case s.sem <- struct{}{}:
		defer func() { <-s.sem }()
	default:
		writeError(w, http.StatusServiceUnavailable, "", "compiler busy, retry shortly")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.timeout)
	defer cancel()

	diagram, _, err := d2lib.Compile(ctx, req.Source, &d2lib.CompileOptions{
		Ruler:  s.ruler,
		Layout: layoutName(engine),
		LayoutResolver: func(string) (d2graph.LayoutGraph, error) {
			return layout, nil
		},
		// No RouterResolver: d2lib falls back to the default edge router.
	}, nil)
	if err != nil {
		// Timeouts/cancellation are server-side failures, not client
		// errors; anything else is a D2 diagnostic, truncated to fit the
		// sync server's error schema.
		if ctx.Err() != nil {
			writeError(w, http.StatusServiceUnavailable, "D2_COMPILER_UNAVAILABLE",
				"D2 compilation timed out, retry shortly")
			return
		}
		writeError(w, http.StatusBadRequest, "", "D2 error: "+truncateError(firstLine(err.Error())))
		return
	}

	resp := compileResponse{Nodes: []nodeJSON{}, Edges: []edgeJSON{}, Engine: engine}
	rootID := diagram.Root.ID
	for _, shape := range diagram.Shapes {
		if shape.ID == "" || shape.ID == rootID {
			continue
		}
		style := map[string]any{}
		if fill := resolveColor(shape.Fill); fill != "" {
			style["fill"] = fill
		}
		if stroke := resolveColor(shape.Stroke); stroke != "" {
			style["stroke"] = stroke
		}
		resp.Nodes = append(resp.Nodes, nodeJSON{
			Key:         shape.ID,
			Label:       shape.Label,
			X:           float64(shape.Pos.X),
			Y:           float64(shape.Pos.Y),
			Width:       float64(shape.Width),
			Height:      float64(shape.Height),
			Shape:       strings.ToLower(shape.Type),
			Style:       style,
			StrokeWidth: float64(shape.StrokeWidth),
		})
	}
	known := make(map[string]bool, len(resp.Nodes))
	for _, n := range resp.Nodes {
		known[n.Key] = true
	}
	for _, conn := range diagram.Connections {
		if conn.Src == "" || conn.Dst == "" {
			continue
		}
		if !known[conn.Src] || !known[conn.Dst] {
			continue
		}
		resp.Edges = append(resp.Edges, edgeJSON{
			Key:    conn.ID,
			Source: conn.Src,
			Target: conn.Dst,
			Label:  conn.Label,
			Color:  resolveColor(conn.Stroke),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func layoutName(engine string) *string {
	name := engine
	return &name
}

// resolveColor turns D2 theme codes (e.g. "B1", "N7") into hex using the
// default light theme. Literal colors pass through untouched.
func resolveColor(code string) string {
	if code == "" {
		return ""
	}
	if color.IsThemeColor(code) {
		return d2themes.ResolveThemeColor(d2themescatalog.NeutralDefault, code)
	}
	return code
}

// firstLine keeps multi-line D2 diagnostics to a short message.
func firstLine(message string) string {
	if index := strings.IndexByte(message, '\n'); index >= 0 {
		return strings.TrimSpace(message[:index])
	}
	return strings.TrimSpace(message)
}

// truncateError caps reflected diagnostics to the sync server's error
// budget; truncateEngine does the same for echoed engine names.
func truncateError(message string) string {
	const maxErrorChars = 2000
	if len(message) > maxErrorChars {
		return message[:maxErrorChars]
	}
	return message
}

func truncateEngine(engine string) string {
	const maxEngineChars = 64
	if len(engine) > maxEngineChars {
		return engine[:maxEngineChars]
	}
	return engine
}
