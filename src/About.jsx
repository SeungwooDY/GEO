import { ORDER, MODES } from './modes'

export default function About() {
  return (
    <main className="about">
      <section className="about-hero">
        <p className="tag mono">What Aperture does</p>
        <h1 className="serif">Every AI answer about you starts with what it was allowed to read.</h1>
        <p className="about-lead">Search engines sent people to your pages. AI models answer for them instead, and they decide what your site means without asking. Aperture is the control layer in between. It reads your site the way an AI does, then lets you set exactly how much of it any AI is given.</p>
      </section>

      <section className="about-modes">
        <p className="tag mono">Three settings</p>
        {ORDER.map((k) => (
          <div className="about-mode" key={k}>
            <div className={`dot d-${k}`} />
            <div>
              <h3 className="serif">{MODES[k].label}<span className="mono"> · {MODES[k].tag}</span></h3>
              <p>{MODES[k].line}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="about-how">
        <p className="tag mono">How it works</p>
        <ol className="serif">
          <li>Point Aperture at a repository or a live URL.</li>
          <li>It crawls the site and scores how AI currently reads it.</li>
          <li>You pick an exposure setting. Aperture writes the files that enforce it.</li>
          <li>Export them, or let it open a pull request against your repo.</li>
          <li>Re-run any time to see the score move.</li>
        </ol>
      </section>
    </main>
  )
}
