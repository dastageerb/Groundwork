// Heading-aware, paragraph-bounded chunks. Contiguous Markdown tables and fences
// stay whole; oversized blocks fail explicitly instead of silently truncating.
export function chunkDocument(text, fallback = 'Document', limit = 2400) {
  text = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const headings = []; const chunks = []; let buffer = ''; let block = []; let fence = false;
  const breadcrumb = () => headings.filter(Boolean).join(' › ') || fallback;
  const flush = () => { if (buffer.trim()) chunks.push({ breadcrumb: breadcrumb(), content: buffer.trim() }); buffer = ''; };
  const addBlock = () => {
    const value = block.join('\n').trim(); block = [];
    if (!value) return;
    if (value.length > 16000) throw new Error('A document block exceeds 16,000 characters. Split the paragraph or table.');
    if (buffer.length + value.length > limit) flush();
    buffer += `${buffer ? '\n\n' : ''}${value}`;
  };
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { addBlock(); flush(); headings.length = heading[1].length; headings[heading[1].length - 1] = heading[2]; }
    else if (!line.trim() && !fence) addBlock();
    else block.push(line);
  }
  addBlock(); flush(); return chunks;
}
export function vectorLiteral(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some(n => typeof n !== 'number' || !Number.isFinite(n)) || vector.every(n => n === 0)) throw new Error('Invalid embedding returned by model');
  return `[${vector.join(',')}]`;
}
