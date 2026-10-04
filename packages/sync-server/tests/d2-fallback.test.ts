import { describe, expect, test } from "bun:test";
import {
  compileD2,
  fallbackLayout,
  parseD2Source,
} from "../src/d2-compiler.js";

describe("D2 local fallback layout", () => {
  test("lays out a simple edge chain on a deterministic grid", () => {
    const result = fallbackLayout("a -> b -> c", "dagre");
    expect(result.fallback).toBe(true);
    expect(result.engine).toBe("dagre");
    expect(result.nodes.map((n) => n.key)).toEqual(["a", "b", "c"]);
    expect(result.edges.map((e) => e.source)).toEqual(["a", "b"]);
    expect(result.edges.map((e) => e.target)).toEqual(["b", "c"]);
    // Deterministic grid: 5 columns, 240x160 spacing from (120, 160).
    expect(result.nodes[0]).toMatchObject({ x: 120, y: 160 });
    expect(result.nodes[1]).toMatchObject({ x: 360, y: 160 });
    expect(result.nodes[2]).toMatchObject({ x: 600, y: 160 });
  });

  test("parses node labels, quoted keys, and edge labels", () => {
    const { nodeKeys, nodeLabels, edges } = parseD2Source(
      `"front end": Web UI\na -> b: ships to`,
    );
    expect(nodeKeys).toContain("front end");
    expect(nodeLabels.get("front end")).toBe("Web UI");
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: "a",
      to: "b",
      label: "ships to",
    });
  });

  test("creates container prefixes for dotted paths and skips directives", () => {
    const { nodeKeys } = parseD2Source(
      "direction: right\ninfra.api: API\ninfra.api -> db",
    );
    expect(nodeKeys).toContain("infra");
    expect(nodeKeys).toContain("infra.api");
    expect(nodeKeys).toContain("db");
    expect(nodeKeys).not.toContain("direction");
  });

  test("ignores comments and attribute lines while keeping the owner node", () => {
    const { nodeKeys } = parseD2Source(
      "# a comment\na.shape: cylinder\na.style.fill: '#ff0000'\nb",
    );
    expect(nodeKeys).toEqual(["a", "b"]);
  });

  test("deduplicates parallel edges instead of collapsing them", () => {
    const { edges } = parseD2Source("a -> b\na -> b");
    expect(edges).toHaveLength(2);
    expect(edges[0].key).not.toBe(edges[1].key);
  });

  test("serves the fallback when no compiler URL is configured (dev)", async () => {
    const result = await compileD2(
      { source: "web -> api -> db" },
      {
        compilerUrl: undefined,
        isDevelopment: true,
        tier: "COMMUNITY",
        nodeLimit: 30,
      },
    );
    expect(result.fallback).toBe(true);
    expect(result.nodes).toHaveLength(3);
  });

  test("refuses to silently fall back in production without a compiler", async () => {
    await expect(
      compileD2(
        { source: "a -> b" },
        {
          compilerUrl: undefined,
          isDevelopment: false,
          tier: "COMMUNITY",
          nodeLimit: 30,
        },
      ),
    ).rejects.toMatchObject({ code: "D2_COMPILER_UNAVAILABLE" });
  });

  test("enforces the Community node cap on fallback layouts", async () => {
    const source = Array.from({ length: 5 }, (_, i) => `n${i}`).join("\n");
    await expect(
      compileD2(
        { source },
        {
          compilerUrl: undefined,
          isDevelopment: true,
          tier: "COMMUNITY",
          nodeLimit: 3,
        },
      ),
    ).rejects.toMatchObject({ code: "TIER_UPGRADE_REQUIRED" });
  });
});
