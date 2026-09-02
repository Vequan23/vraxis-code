/**
 * xterm captures keyboard input through an invisible textarea. Give browser
 * autofill implementations an explicit non-credential contract so password
 * managers do not mistake the terminal prompt for a sign-in field.
 */
export function configureTerminalInput(textarea: HTMLTextAreaElement): void {
  textarea.setAttribute("aria-label", "Terminal input");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("name", "vraxis-terminal-input");
  textarea.setAttribute("data-form-type", "other");
  textarea.setAttribute("data-1p-ignore", "true");
  textarea.setAttribute("data-lpignore", "true");
  textarea.setAttribute("data-bwignore", "true");
  textarea.setAttribute("data-protonpass-ignore", "true");
}
