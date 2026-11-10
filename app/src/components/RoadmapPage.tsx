import { useMemo } from 'react';
import { type Token, type Tokens, marked } from 'marked';
import source from '../content/roadmap.md?raw';
import { COINFLIP_FEE_BPS } from '../config';

type Status = 'live' | 'building' | 'next' | 'planned';
type Milestone = { status: Status; title: string; html: string };
type Section = { title: string; html: string; milestones: Milestone[] };

const STATUSES: Status[] = ['live', 'building', 'next', 'planned'];

/** Markdown → HTML for one group of tokens, with TODO placeholders highlighted. */
function render(tokens: Token[]): string {
  const html = marked.parser(Object.assign(tokens, { links: {} }) as never) as string;
  return html.replace(/(<p>|<li>)TODO:/g, '$1<span class="rm-todo">TODO</span>');
}

/**
 * Splits src/content/roadmap.md into: intro (# heading + text), ## sections, and ### milestones
 * inside a section. The file is written by the site owner, so its HTML is trusted.
 */
function parse(md: string) {
  const tokens = marked.lexer(md.replace(/<!--[\s\S]*?-->/g, ''), { gfm: true });
  let title = 'Roadmap';
  const intro: Token[] = [];
  const sections: Section[] = [];
  let section: { title: string; body: Token[]; milestones: { status: Status; title: string; body: Token[] }[] } | null = null;
  const flush = () => {
    if (!section) return;
    sections.push({
      title: section.title,
      html: render(section.body),
      milestones: section.milestones.map((m) => ({ status: m.status, title: m.title, html: render(m.body) })),
    });
  };
  for (const t of tokens) {
    if (t.type === 'heading' && (t as Tokens.Heading).depth === 1) {
      title = (t as Tokens.Heading).text;
    } else if (t.type === 'heading' && (t as Tokens.Heading).depth === 2) {
      flush();
      section = { title: (t as Tokens.Heading).text, body: [], milestones: [] };
    } else if (t.type === 'heading' && (t as Tokens.Heading).depth === 3 && section) {
      const m = (t as Tokens.Heading).text.match(/^\[(LIVE|BUILDING|NEXT|PLANNED)\]\s*(.*)$/i);
      section.milestones.push({
        status: (m ? m[1].toLowerCase() : 'planned') as Status,
        title: m ? m[2] : (t as Tokens.Heading).text,
        body: [],
      });
    } else if (section) {
      const last = section.milestones[section.milestones.length - 1];
      (last ? last.body : section.body).push(t);
    } else {
      intro.push(t);
    }
  }
  flush();
  return { title, introHtml: render(intro), sections };
}

export function RoadmapPage() {
  const { title, introHtml, sections } = useMemo(() => parse(source), []);
  const textSections = sections.filter((s) => s.milestones.length === 0);
  const timelines = sections.filter((s) => s.milestones.length > 0);
  const feePct = Number(COINFLIP_FEE_BPS) / 100;

  return (
    <div className="roadmap-page">
      <header className="rm-hero panel">
        <div className="eyebrow">
          <span className="red-line" /> DEGENWILD
        </div>
        <h1>{title}</h1>
        <div className="rm-intro" dangerouslySetInnerHTML={{ __html: introHtml }} />
      </header>

      {textSections.length > 0 && (
        <div className="rm-cards">
          {textSections.map((s) => (
            <section key={s.title} className="rm-card panel">
              <h2>{s.title}</h2>
              {/fee/i.test(s.title) && (
                <div className="rm-feebar" aria-label={`Winner ${100 - feePct}%, platform fee ${feePct}%`}>
                  <div className="rm-feebar-win" style={{ flexBasis: `${100 - feePct}%` }}>
                    <b>{100 - feePct}%</b> to the winner
                  </div>
                  <div className="rm-feebar-fee" style={{ flexBasis: `${feePct}%` }} />
                  <small>
                    <b>{feePct}%</b> platform fee
                  </small>
                </div>
              )}
              <div className="rm-body" dangerouslySetInnerHTML={{ __html: s.html }} />
            </section>
          ))}
        </div>
      )}

      {timelines.map((s) => (
        <section key={s.title} className="rm-timeline-section">
          <div className="lobby-heading">
            <div>
              <div className="eyebrow">WHAT'S DONE AND WHAT'S NEXT</div>
              <h2>{s.title}</h2>
            </div>
            <div className="rm-legend">
              {STATUSES.map((st) => (
                <span key={st} className={`rm-status ${st}`}>
                  {st.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
          {s.html.trim() && <div className="rm-body" dangerouslySetInnerHTML={{ __html: s.html }} />}
          <ol className="rm-timeline">
            {s.milestones.map((m, i) => (
              <li key={i} className={`rm-step ${m.status}`}>
                <span className="rm-dot" aria-hidden="true" />
                <div className="rm-step-card panel">
                  <span className={`rm-status ${m.status}`}>{m.status.toUpperCase()}</span>
                  <h3>{m.title}</h3>
                  <div className="rm-body" dangerouslySetInnerHTML={{ __html: m.html }} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
