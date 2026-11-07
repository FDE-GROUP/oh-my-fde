import { describe, expect, it } from "vitest";
import { formatQuote } from "../src/lib/quote.ts";

describe("formatQuote", () => {
	it("prefixes a single line", () => {
		expect(formatQuote("hello")).toBe("> hello");
	});

	it("prefixes every line of a multi-line selection", () => {
		expect(formatQuote("line one\nline two")).toBe("> line one\n> line two");
	});

	it("writes a bare > for interior blank lines without trailing space", () => {
		expect(formatQuote("a\n\nb")).toBe("> a\n>\n> b");
	});

	it("trims leading and trailing whitespace before quoting", () => {
		expect(formatQuote("  \n  padded  \n ")).toBe("> padded");
	});

	it("returns empty string for whitespace-only selection", () => {
		expect(formatQuote("   \n\t ")).toBe("");
	});

	it("returns empty string for empty selection", () => {
		expect(formatQuote("")).toBe("");
	});
});
