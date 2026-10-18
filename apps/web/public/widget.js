/* Groundwork launcher: no credentials, messages, or document data enter the host page. */
(() => {
  const script = document.currentScript;
  if (!script || document.querySelector('[data-groundwork-launcher]')) return;
  const origin = new URL(script.src).origin;
  const host = document.createElement('div');
  host.setAttribute('data-groundwork-launcher', '');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{position:fixed;bottom:24px;right:24px;z-index:2147483000}button{font:600 14px system-ui,sans-serif;background:#6d2cf0;color:white;border:1px solid #9870ee;border-radius:999px;padding:15px 22px;box-shadow:0 8px 30px #35206435;cursor:pointer}button:focus-visible{outline:3px solid #baa2f4;outline-offset:4px}';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = script.dataset.groundworkTitle || 'Ask Groundwork';
  button.setAttribute('aria-label', button.textContent + ' (opens a new window)');
  button.addEventListener('click', () => window.open(origin + '/widget', '_blank', 'popup,width=540,height=760,noopener,noreferrer'));
  root.append(style, button); document.body.append(host);
})();
