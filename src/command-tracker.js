// Retain only slash-command / skill names, never ordinary prompt text or args.
export class CommandTracker {
  constructor() { this.reset(); }
  reset() { this.candidate = ''; this.ignored = false; this.arguments = false; }
  accept(data) {
    const text = data.replace(/\x1b\[20[01]~/g, '');
    if (text.includes('\x1b')) { this.reset(); return null; }
    let result = null;
    for (const char of text) {
      if (char === '\r' || char === '\n') {
        if (!this.ignored && /^[/$][a-z][a-z0-9_:-]*$/i.test(this.candidate)) result = { kind: this.candidate[0] === '/' ? 'command' : 'skill', name: this.candidate };
        this.reset();
      } else if (char === '\x15' || char === '\x03') this.reset();
      else if (char === '\x7f' || char === '\b') { if (!this.arguments) this.candidate = this.candidate.slice(0, -1); }
      else if (!this.ignored) {
        if (!this.candidate && char !== '/' && char !== '$') this.ignored = true;
        else if (char === ' ') this.arguments = true;
        else if (!this.arguments && this.candidate.length < 80) this.candidate += char;
      }
    }
    return result;
  }
}
