// @vitest-environment jsdom
// index.html and the element lookups agree both ways: every id main.ts looks up is in the page, and
// every id in the page is looked up (or pointed at from inside the page), so markup and wiring
// cannot drift apart unnoticed.
import { getShellElements } from "@brain-bbqs/ui";
import { expectIdContract, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { describe, expect, it } from "vitest";
import { getElements } from "../../src/ui/elements";

describe("index.html and the element lookups", () => {
  it("agree both ways, the account menu main.ts requires included", () => {
    const contract = expectIdContract({ html: readIndexHtml(), lookups: [getElements, () => getShellElements()] });
    // getShellElements tolerates a page without the account menu; this page must have it.
    expect(contract.absent).toEqual([]);
    expect(contract.optional).toEqual(["oauthSigninBtn"]);
  });

  it("register the What's New link and modal, its heading through the dialog's aria-labelledby", () => {
    const contract = expectIdContract({ html: readIndexHtml(), lookups: [getElements, () => getShellElements()] });
    expect(contract.required).toEqual(
      expect.arrayContaining(["whats-new-button", "whats-new-modal", "whats-new-close", "whats-new-content", "whats-new-show-more"]),
    );
    expect(contract.registered).not.toContain("whats-new-modal-title");
  });

  it.each(["selbarWrap", "speedGroup"])("registers #%s, which only style.css reads", (id) => {
    const contract = expectIdContract({ html: readIndexHtml(), lookups: [getElements, () => getShellElements()] });
    expect(contract.required).toContain(id);
  });
});
