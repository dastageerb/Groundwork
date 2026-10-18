import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { HttpError } from './retrieval.js';
import { Capacity } from './capacity.js';
const parsers = new Capacity(2, 2);
export async function extractDocument(buffer, filename) {
  return parsers.run(()=>extract(buffer,filename),AbortSignal.timeout(120000));
}
async function extract(buffer, filename) {
  const extension = path.extname(filename).toLowerCase();
  if (!['.md','.txt','.pdf','.docx'].includes(extension)) throw new HttpError(422, 'Use Markdown, text, PDF, or Word (.docx). Legacy .doc files must be converted to .docx.');
  if (buffer.length > 10 * 1024 * 1024) throw new HttpError(422, 'Files must be 10 MB or smaller.');
  let text;
  if (extension === '.md' || extension === '.txt') text = buffer.toString('utf8');
  else text = await new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./parser-worker.js',import.meta.url), { workerData: { buffer, extension }, resourceLimits:{maxOldGenerationSizeMb:256} });
    const timer = setTimeout(()=>{worker.terminate();reject(new HttpError(422,'Document parsing timed out. Split the file into smaller documents.'));},60000);
    worker.once('message',result=>{clearTimeout(timer);worker.terminate();result.error?reject(new HttpError(422,result.error)):resolve(result.text);});
    worker.once('error',()=>{clearTimeout(timer);reject(new HttpError(422,'Unable to parse this document. Check that it is valid and not encrypted.'));});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new HttpError(422,'Document parser stopped. Try a smaller file.'));});
  });
  if (!text.trim()) throw new HttpError(422,'No readable text found. Scanned PDFs need OCR before importing.');
  if (text.length > 2_000_000) throw new HttpError(422,'Extracted text exceeds 2 million characters. Split the document.');
  return text;
}
