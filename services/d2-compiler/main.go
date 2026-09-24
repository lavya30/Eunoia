// Command d2-compiler is Eunoia's D2 layout microservice.
//
// It wraps terrastruct/d2's Dagre layout engine behind a small HTTP API
// consumed by the sync server (POST /api/compile forwards here):
//
//	POST /compile  {source, engine, tier} -> {nodes, edges, engine}
//	GET  /healthz  -> {status, engine}
//
// Only the "dagre" engine is supported; anything else is rejected with
// INVALID_ENGINE so tier gating stays authoritative in the sync server.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/d2lang/d2/lib/textmeasure"
)

const (
	defaultPort            = "9400"
	defaultMaxConcurrent   = 4
	defaultTimeoutSec      = 15
	defaultMaxSourceBytes  = 512_000
	shutdownDrainTimeout   = 10 * time.Second
	healthcheckCacheHeader = "no-store"
)

type compileRequest struct {
	Source string `json:"source"`
	Engine string `json:"engine"`
	Tier   string `json:"tier"`
}

type errorBody struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

func main() {
	port := envOr("PORT", defaultPort)
	maxConcurrent, err := envInt("MAX_CONCURRENT_COMPILES", defaultMaxConcurrent)
	if err != nil || maxConcurrent < 1 {
		log.Fatalf("invalid MAX_CONCURRENT_COMPILES: %v", err)
	}
	timeoutSec, err := envInt("COMPILE_TIMEOUT_SEC", defaultTimeoutSec)
	if err != nil || timeoutSec < 1 {
		log.Fatalf("invalid COMPILE_TIMEOUT_SEC: %v", err)
	}
	maxSourceBytes, err := envInt("MAX_SOURCE_BYTES", defaultMaxSourceBytes)
	if err != nil || maxSourceBytes < 1 {
		log.Fatalf("invalid MAX_SOURCE_BYTES: %v", err)
	}

	ruler, err := textmeasure.NewRuler()
	if err != nil {
		log.Fatalf("failed to initialize text ruler: %v", err)
	}

	srv := &server{
		ruler:          ruler,
		sem:            make(chan struct{}, maxConcurrent),
		timeout:        time.Duration(timeoutSec) * time.Second,
		maxSourceBytes: int64(maxSourceBytes),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/compile", srv.handleCompile)
	mux.HandleFunc("/healthz", handleHealthz)

	httpSrv := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("d2-compiler listening on :%s (dagre, max %d concurrent, %ds timeout)", port, maxConcurrent, timeoutSec)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	ctx, cancel := context.WithTimeout(context.Background(), shutdownDrainTimeout)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", healthcheckCacheHeader)
	_, _ = w.Write([]byte(`{"status":"ok","engine":"dagre"}`))
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorBody{Error: message, Code: code})
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	return strconv.Atoi(raw)
}
