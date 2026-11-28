// T2.2 (B24): the opt-in readable UI components in Frontend/Shared/ui.
// Each one renders, passes axe, and behaves for keyboard and screen reader users.
// Colour contrast is checked on the tokens (readableUiTheme.test.js) because
// jsdom has no layout; the real-browser axe run is in the PR screenshots.
import React, { createRef, useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";

import BigButton from "@shared/ui/BigButton";
import Card from "@shared/ui/Card";
import Sheet from "@shared/ui/Sheet";
import Field from "@shared/ui/Field";

const URDU_HELP = "اپنے کلب کا نام لکھیں";
const URDU_ERROR = "کلب کا نام لکھیں";

async function axeViolations(node) {
  // `region` wants every node inside a page landmark; these are single
  // components without the app shell, so it cannot pass here.
  // `color-contrast` needs real layout and canvas, which jsdom lacks; contrast
  // is tested on the tokens and with axe in a real browser instead.
  const results = await axe.run(node, { rules: { region: { enabled: false }, "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("BigButton", () => {
  it("renders a primary button named by its label", () => {
    render(<BigButton>Start match</BigButton>);
    const button = screen.getByRole("button", { name: "Start match" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ui-button", "ui-button--primary");
  });

  it("supports secondary, danger and success; anything else falls back to secondary", () => {
    render(
      <>
        <BigButton variant="secondary">Later</BigButton>
        <BigButton variant="danger">Out</BigButton>
        <BigButton variant="success">Yes</BigButton>
        <BigButton variant="shiny">Odd</BigButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Later" })).toHaveClass("ui-button--secondary");
    expect(screen.getByRole("button", { name: "Out" })).toHaveClass("ui-button--danger");
    expect(screen.getByRole("button", { name: "Yes" })).toHaveClass("ui-button--success");
    const odd = screen.getByRole("button", { name: "Odd" });
    expect(odd).toHaveClass("ui-button--secondary");
    expect(odd).not.toHaveClass("ui-button--shiny");
  });

  it("has a scoring pad size and a full-width option", () => {
    render(
      <>
        <BigButton size="pad">4</BigButton>
        <BigButton block>Save</BigButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "4" })).toHaveClass("ui-button--pad");
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("ui-button--block");
  });

  it("hides the icon from screen readers so the name is the label only", () => {
    render(<BigButton icon={<svg data-testid="icon" />}>Share</BigButton>);
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByTestId("icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("passes props through, forwards its ref and respects disabled", () => {
    const onClick = vi.fn();
    const ref = createRef();
    render(
      <>
        <BigButton ref={ref} type="submit" onClick={onClick} className="mt-4" data-testid="go">Go</BigButton>
        <BigButton disabled onClick={onClick}>Off</BigButton>
      </>,
    );
    const go = screen.getByRole("button", { name: "Go" });
    expect(ref.current).toBe(go);
    expect(go).toHaveAttribute("type", "submit");
    expect(go).toHaveClass("mt-4");
    fireEvent.click(go);
    fireEvent.click(screen.getByRole("button", { name: "Off" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <div>
        <BigButton>Start match</BigButton>
        <BigButton variant="secondary">Later</BigButton>
        <BigButton variant="danger" icon={<svg />}>Out</BigButton>
        <BigButton variant="success">Yes</BigButton>
        <BigButton size="pad">6</BigButton>
        <BigButton disabled>Off</BigButton>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Card", () => {
  it("shows a level 2 heading by default", () => {
    render(<Card title="Today">Body</Card>);
    const heading = screen.getByRole("heading", { level: 2, name: "Today" });
    expect(heading).toHaveClass("ui-card__title");
    expect(heading.closest(".ui-card")).toHaveTextContent("Body");
  });

  it("can be a section named by its title, with another heading level", () => {
    render(<Card as="section" title="Next match" headingLevel={3}>Body</Card>);
    expect(screen.getByRole("heading", { level: 3, name: "Next match" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Next match" })).toHaveClass("ui-card");
  });

  it("renders without a title and without a heading", () => {
    const { container } = render(<Card className="extra">Only body</Card>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.firstChild).toHaveClass("ui-card", "extra");
    expect(container.firstChild).not.toHaveAttribute("aria-labelledby");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <div>
        <Card title="Today"><p>Two matches</p></Card>
        <Card as="section" title="Next match"><p>Sat 2 pm</p></Card>
        <Card><p>No title</p></Card>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

function SheetHarness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <div>
      <BigButton onClick={() => setOpen(true)}>Who is out?</BigButton>
      <Sheet open={open} onClose={close} title="How out?">
        <BigButton variant="secondary" onClick={close}>Bowled</BigButton>
        <BigButton variant="secondary" onClick={close}>Caught</BigButton>
        <BigButton variant="secondary" onClick={close}>Cancel</BigButton>
      </Sheet>
    </div>
  );
}

describe("Sheet", () => {
  it("renders nothing while closed", () => {
    render(<Sheet open={false} onClose={() => {}} title="How out?">Body</Sheet>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as a modal dialog named by its title, in document.body", () => {
    const { container } = render(<Sheet open onClose={() => {}} title="How out?">Body</Sheet>);
    const dialog = screen.getByRole("dialog", { name: "How out?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("ui-sheet");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("moves focus into the sheet and gives it back to the opener on close", () => {
    render(<SheetHarness />);
    const opener = screen.getByRole("button", { name: "Who is out?" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Who is out?" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a tap outside the sheet but not inside it", () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="How out?"><p>Pick one</p></Sheet>);
    fireEvent.click(screen.getByText("Pick one"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog").parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the sheet", () => {
    render(<SheetHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Who is out?" }));
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "Bowled" });
    const last = screen.getByRole("button", { name: "Cancel" });

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("has no axe violations when open", async () => {
    render(<SheetHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Who is out?" }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("Field", () => {
  it("links the English label to the input", () => {
    render(<Field label="Club name" name="name" placeholder="e.g. Young Star" required />);
    const input = screen.getByLabelText("Club name");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveClass("ui-field__control");
    expect(input).toHaveAttribute("name", "name");
    expect(input).toHaveAttribute("placeholder", "e.g. Young Star");
    expect(input).toBeRequired();
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("has no Urdu line until one is given", () => {
    const { container } = render(<Field label="Club name" />);
    expect(container.querySelector('[lang="ur"]')).toBeNull();
    expect(screen.getByLabelText("Club name")).not.toHaveAttribute("aria-describedby");
  });

  it("shows one Urdu help line under the input, right-to-left, linked for screen readers", () => {
    const { container } = render(<Field label="Club name" urduHelp={URDU_HELP} />);
    const input = screen.getByLabelText("Club name");
    const urdu = container.querySelectorAll('[lang="ur"]');
    expect(urdu).toHaveLength(1);
    expect(urdu[0]).toHaveAttribute("dir", "rtl");
    expect(urdu[0]).toHaveClass("ui-field__urdu");
    expect(urdu[0]).toHaveTextContent(URDU_HELP);
    expect(input.compareDocumentPosition(urdu[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input).toHaveAccessibleDescription(URDU_HELP);
    // The page itself stays left-to-right.
    expect(container.firstChild).not.toHaveAttribute("dir");
  });

  it("marks an error in English with an Urdu line, and describes the input with both", () => {
    const { container } = render(
      <Field label="Club name" urduHelp={URDU_HELP} error="Enter a club name" urduError={URDU_ERROR} />,
    );
    const input = screen.getByLabelText("Club name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const description = input.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id).textContent).join(" ");
    expect(description).toContain("Enter a club name");
    expect(description).toContain(URDU_ERROR);
    expect(description).toContain(URDU_HELP);
    const urduError = [...container.querySelectorAll('[lang="ur"]')].find((n) => n.textContent === URDU_ERROR);
    expect(urduError).toHaveAttribute("dir", "rtl");
  });

  it("keeps an aria-describedby passed in by the form", () => {
    render(
      <>
        <p id="club-rules">Use the name on your kit.</p>
        <Field label="Club name" urduHelp={URDU_HELP} aria-describedby="club-rules" />
      </>,
    );
    const ids = screen.getByLabelText("Club name").getAttribute("aria-describedby").split(" ");
    expect(ids[0]).toBe("club-rules");
    expect(ids).toHaveLength(2);
  });

  it("can render a select or a textarea, and forwards its ref", () => {
    const ref = createRef();
    render(
      <>
        <Field ref={ref} as="select" label="Ball type" defaultValue="tape">
          <option value="tape">Tape ball</option>
          <option value="hard">Hard ball</option>
        </Field>
        <Field as="textarea" label="Notes" id="notes" />
      </>,
    );
    const select = screen.getByLabelText("Ball type");
    expect(select.tagName).toBe("SELECT");
    expect(ref.current).toBe(select);
    expect(screen.getByRole("option", { name: "Hard ball" })).toBeInTheDocument();
    const notes = screen.getByLabelText("Notes");
    expect(notes.tagName).toBe("TEXTAREA");
    expect(notes).toHaveAttribute("id", "notes");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <form>
        <Field label="Club name" placeholder="e.g. Young Star" />
        <Field label="City" urduHelp="اپنا شہر لکھیں" />
        <Field label="Team name" urduHelp={URDU_HELP} error="Enter a club name" urduError={URDU_ERROR} />
        <Field as="select" label="Ball type">
          <option value="tape">Tape ball</option>
        </Field>
        <Field as="textarea" label="Notes" />
      </form>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
