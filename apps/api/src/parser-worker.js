import { parentPort, workerData } from 'node:worker_threads';
try {
  const buffer=Buffer.from(workerData.buffer);let text='';
  if(workerData.extension==='.pdf') {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
    try {
      const doc=await task.promise;
      if(doc.numPages>1000)throw new Error('PDFs must have no more than 1,000 pages.');
      for(let page=1;page<=doc.numPages;page++) {
        const content=await (await doc.getPage(page)).getTextContent();
        text+=`\n\n## Page ${page}\n\n`+content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
        if(text.length>2_000_000)throw new Error('Extracted text is too large.');
      }
    }finally{await task.destroy();}
  }else{
    const mammoth=await import('mammoth');
    const {default:Turndown}=await import('turndown');
    const {gfm}=await import('turndown-plugin-gfm');
    const result=await mammoth.convertToHtml({buffer},{externalFileAccess:false,convertImage:mammoth.images.imgElement(async()=>({src:''}))});
    const converter=new Turndown({headingStyle:'atx'});converter.use(gfm);converter.remove(['script','style','img']);text=converter.turndown(result.value);
  }
  // Only plain Markdown is returned; generated HTML never reaches a browser.
  parentPort.postMessage({text});
}catch(error){parentPort.postMessage({error:error.message?.slice(0,200)||'Unable to parse document.'});}
