const loopbackAddress = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

export function normalizeBrowserAddress(input: string): string {
  let value = input.trim();
  if (!value) throw new TypeError("Enter a URL to open.");
  if (/\s/.test(value)) throw new TypeError("Enter a URL without spaces.");
  if (value.startsWith("//")) value = `https:${value}`;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    value = `${loopbackAddress.test(value) ? "http" : "https"}://${value}`;
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("Enter a valid browser URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Browser URLs must use HTTP or HTTPS.");
  }
  if (url.username || url.password) throw new TypeError("Browser URLs cannot contain credentials.");
  if (!url.hostname) throw new TypeError("Enter a valid browser URL.");
  return url.href;
}
