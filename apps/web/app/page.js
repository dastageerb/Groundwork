'use client';

import { useState } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  FileText,
  Server,
  Search,
  LockKeyhole,
  Check,
  Terminal,
  Cpu,
  X,
  Copy,
} from 'lucide-react';
import Brand from '../components/brand';
import Demo from '../components/demo';

export default function Landing() {
  const [showDemoNotice, setShowDemoNotice] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleOpenWorkspace = (e) => {
    // If running on a deployed website (Netlify, Vercel, public domain)
    if (
      typeof window !== 'undefined' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      e.preventDefault();
      setShowDemoNotice(true);
    }
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(
      'git clone https://github.com/dastageerb/Groundwork.git && cd Groundwork && docker compose up --build'
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <main className="landing">
      {/* Header Nav */}
      <header className="landing-nav">
        <Brand />
        <nav>
          <a href="#how">How it works</a>
          <a href="#features">Why Groundwork</a>
          <a
            href="/workspace"
            onClick={handleOpenWorkspace}
            className="button small outline"
          >
            Open workspace <ArrowRight size={15} />
          </a>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="little-dot" /> YOUR KNOWLEDGE. ON YOUR TERMS.
          </span>
          <h1>Private AI for your company’s documents.</h1>
          <p>
            Every answer traced to its source.
            <br />
            Nothing leaves your servers.
          </p>
          <div className="actions">
            <a
              className="button"
              href="/workspace"
              onClick={handleOpenWorkspace}
            >
              Get started <ArrowRight size={17} />
            </a>
            <a className="button outline" href="#how">
              See how it works
            </a>
          </div>
          <div className="hero-proof">
            <span>
              <Check size={14} /> Self-hosted
            </span>
            <span>
              <Check size={14} /> Local models
            </span>
            <span>
              <Check size={14} /> No per-token fees
            </span>
          </div>
        </div>
        <div className="hero-art">
          <img
            src="/hero.svg"
            alt="Company documents connected to a private search engine that returns a source-backed answer"
          />
          <span className="art-note">
            <LockKeyhole size={13} /> A closed loop. A clearer answer.
          </span>
        </div>
      </section>

      {/* Interactive Demo Section */}
      <section className="demo-section">
        <div className="section-label">
          <span />
          FROM “WHERE IS THAT POLICY?” TO “HERE IT IS.”
          <span />
        </div>
        <Demo />
        <p className="caption">
          An example conversation using a fictional company handbook.
        </p>
      </section>

      {/* Problem Section */}
      <section className="problem section">
        <div>
          <span className="eyebrow">LESS SEARCHING. MORE KNOWING.</span>
          <h2>
            Your policies are buried in documents.
            <br />
            <span>Your people shouldn’t be.</span>
          </h2>
        </div>
        <p>
          The handbook is somewhere. The answer is on page 47. And your team is
          asking the same question again.
          <br />
          <br />
          Groundwork turns the documents you already have into answers people can
          actually find.
        </p>
      </section>

      {/* How it works */}
      <section id="how" className="section how">
        <span className="eyebrow">SIMPLE BY DESIGN</span>
        <h2>
          Three steps from
          <br />
          document to proof.
        </h2>
        <div className="three-grid">
          {[
            [
              FileText,
              '01',
              'Bring your knowledge',
              'Point Groundwork at a folder of handbooks, policies, and manuals. Your files stay on your hardware.',
            ],
            [
              Search,
              '02',
              'Ask a real question',
              'Employees ask in plain language. Groundwork searches your documents and checks for a relevant match.',
            ],
            [
              ShieldCheck,
              '03',
              'Get an answer with proof',
              'A local model answers from the matching sections, with sources you can open and verify.',
            ],
          ].map(([Icon, n, title, copy]) => (
            <article key={n} className="step-card">
              <div className="step-top">
                <Icon size={27} />
                <span>{n}</span>
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="section features">
        <div>
          <span className="eyebrow">BUILT TO STAY IN-HOUSE</span>
          <h2>
            Everything you need.
            <br />
            Nothing you have to send out.
          </h2>
          <p className="muted">
            A focused assistant for your company’s knowledge.
          </p>
        </div>
        <div className="feature-grid">
          {[
            [
              Server,
              'Your hardware. Your data.',
              'Documents, questions, and answers stay within your own infrastructure.',
            ],
            [
              FileText,
              'Sources, not guesswork',
              'See the document and section used to produce an answer.',
            ],
            [
              ShieldCheck,
              'A gate before generation',
              'Off-topic questions are declined before the chat model is called.',
            ],
            [
              Cpu,
              'Start small, grow later',
              'Run light local models or choose a larger one for your hardware.',
            ],
          ].map(([Icon, title, copy]) => (
            <article key={title}>
              <Icon size={23} />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Terminal Callout */}
      <section className="section start" id="start">
        <div>
          <span className="eyebrow">MAKE YOUR KNOWLEDGE WORK</span>
          <h2>
            A little setup.
            <br />
            A lot less searching.
          </h2>
          <p>
            Start with the fictional handbook.
            <br />
            Make it your own when you’re ready.
          </p>
          <a
            className="button white"
            href="/workspace"
            onClick={handleOpenWorkspace}
          >
            Open your workspace <ArrowRight size={17} />
          </a>
        </div>
        <div className="terminal">
          <div>
            <Terminal size={16} />
            <span>YOUR SERVER</span>
            <i />
            <i />
            <i />
          </div>
          <pre>
            <span># Build and start Groundwork</span>
            {'\n'}docker compose up --build{'\n\n'}
            <span># Then open your workspace</span>
            {'\n'}http://localhost:3000
          </pre>
          <small>
            <LockKeyhole size={13} /> Local by default. Private by design.
          </small>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <Brand />
        <span>A solid foundation for your company’s knowledge.</span>
        <a href="/workspace" onClick={handleOpenWorkspace}>
          Open workspace ↗
        </a>
      </footer>

      {/* Self-Hosted Architecture Notice Modal (Triggered on Deployed Sites) */}
      {showDemoNotice && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(14, 11, 30, 0.72)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setShowDemoNotice(false)}
        >
          <div
            style={{
              background: '#fbfafd',
              border: '1px solid #d9d0fa',
              borderRadius: '24px',
              maxWidth: '540px',
              width: '100%',
              padding: '32px',
              boxShadow: '0 25px 60px rgba(110, 70, 220, 0.28)',
              position: 'relative',
              animation: 'appear 0.2s ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowDemoNotice(false)}
              style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                border: 0,
                background: 'transparent',
                color: '#8b809f',
                cursor: 'pointer',
                padding: '6px',
                borderRadius: '8px',
              }}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <div
                className="feature-icon"
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'var(--pale)',
                  color: 'var(--purple)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <LockKeyhole size={22} />
              </div>
              <div>
                <span
                  className="eyebrow"
                  style={{ fontSize: '9px', letterSpacing: '1.2px' }}
                >
                  SELF-HOSTED ARCHITECTURE
                </span>
                <h3
                  style={{
                    fontSize: '20px',
                    fontWeight: 700,
                    margin: '3px 0 0',
                    color: 'var(--dark)',
                  }}
                >
                  Private Workspace Notice
                </h3>
              </div>
            </div>

            <p
              style={{
                fontSize: '13.5px',
                lineHeight: 1.6,
                color: 'var(--muted)',
                margin: '0 0 18px',
              }}
            >
              You are viewing the online demo showcase. Because Groundwork is
              engineered for <strong>100% data sovereignty</strong>, the
              document indexing and local AI models (Ollama) run in an isolated
              Docker environment on your own private infrastructure.
            </p>

            <div
              className="terminal"
              style={{
                margin: '0 0 20px',
                background: '#361480',
                borderRadius: '12px',
              }}
            >
              <div
                style={{
                  padding: '9px 15px',
                  fontSize: '9px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#b398df',
                }}
              >
                <Terminal size={13} />
                <span>RUN LOCALLY WITH DOCKER</span>
              </div>
              <pre
                style={{
                  padding: '14px 18px',
                  fontSize: '11.5px',
                  lineHeight: 1.8,
                  color: '#fff',
                }}
              >
                <span style={{ color: '#b398df' }}># 1. Clone repository</span>
                {'\n'}git clone https://github.com/dastageerb/Groundwork.git
                {'\n'}cd Groundwork{'\n\n'}
                <span style={{ color: '#b398df' }}>
                  # 2. Build and launch services
                </span>
                {'\n'}docker compose up --build
              </pre>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                className="button"
                style={{
                  flex: 1,
                  minWidth: '170px',
                  padding: '11px 18px',
                  fontSize: '13px',
                }}
                onClick={handleCopyCommand}
              >
                {copied ? (
                  <>
                    <Check size={16} /> Copied to clipboard!
                  </>
                ) : (
                  <>
                    <Copy size={15} /> Copy Docker command
                  </>
                )}
              </button>

              <a
                href="/workspace"
                className="button outline"
                style={{ padding: '11px 18px', fontSize: '13px' }}
              >
                Preview UI anyway <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
