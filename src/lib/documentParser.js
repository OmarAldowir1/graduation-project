import JSZip from 'jszip';
import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = (err) => reject(err || new Error('Error reading text file'));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err || new Error('Error reading array buffer'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extracts slide text and speaker notes from PowerPoint (.pptx) file
 */
async function parsePptxFile(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buffer);

  // Find all slide XML files
  const slideKeys = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0], 10);
      const numB = parseInt(b.match(/\d+/)[0], 10);
      return numA - numB;
    });

  if (slideKeys.length === 0) {
    throw new Error('No slides found inside this PowerPoint presentation.');
  }

  const slidesOutput = [];

  for (const slideKey of slideKeys) {
    const slideNumber = slideKey.match(/\d+/)[0];
    const xml = await zip.files[slideKey].async('text');

    // Extract all text elements (<a:t>...</a:t>)
    const textMatches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
    const slideLines = textMatches
      .map((tag) => decodeXmlEntities(tag.replace(/<\/?a:t[^>]*>/gi, '').trim()))
      .filter(Boolean);

    const slideContent = slideLines.join(' ');
    slidesOutput.push(`--- Slide ${slideNumber} ---\n${slideContent || '(No text content on this slide)'}`);
  }

  const fullText = `[Presentation File: ${file.name}]\n[Total Slides: ${slideKeys.length}]\n\n${slidesOutput.join('\n\n')}`;

  return {
    name: file.name,
    size: file.size,
    fileType: 'pptx',
    fileTypeLabel: 'PowerPoint Presentation',
    icon: 'slideshow',
    mimeType: 'text/plain',
    content: fullText,
    stats: {
      slidesCount: slideKeys.length
    }
  };
}

/**
 * Extracts text from Word (.docx) file
 */
async function parseDocxFile(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.files['word/document.xml'];

  if (!docFile) {
    throw new Error('word/document.xml not found inside this Word document.');
  }

  const xml = await docFile.async('text');
  // Match paragraphs
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/gi) || [];
  const lines = [];

  for (const p of paragraphs) {
    const textMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
    const pText = textMatches
      .map((t) => decodeXmlEntities(t.replace(/<\/?w:t[^>]*>/gi, '')))
      .join('');
    if (pText.trim()) {
      lines.push(pText.trim());
    }
  }

  const fullText = `[Word Document: ${file.name}]\n\n${lines.join('\n\n')}`;

  return {
    name: file.name,
    size: file.size,
    fileType: 'docx',
    fileTypeLabel: 'Word Document',
    icon: 'article',
    mimeType: 'text/plain',
    content: fullText,
    stats: {
      paragraphsCount: lines.length
    }
  };
}

/**
 * Universal document parser supporting PDF, PPTX, DOCX, and Text/Code files
 */
export async function parseAttachedDocument(file) {
  if (!file) return null;

  const fileName = file.name.toLowerCase();
  const maxBytes = 16 * 1024 * 1024; // 16MB limit

  if (file.size > maxBytes) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size is 16MB.`);
  }

  // 1. Extract PDF text locally; the Cloudflare text model does not read PDFs.
  if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
    const document = await getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
    const pages = [];
    for (let number = 1; number <= document.numPages && pages.join('').length < 16000; number++) {
      const page = await document.getPage(number);
      const text = await page.getTextContent();
      pages.push(`Page ${number}: ${text.items.map(item => item.str || '').join(' ')}`);
    }
    const content = pages.join('\n\n').slice(0, 16000);
    if (!content.trim()) throw new Error('This PDF has no selectable text. Scanned PDFs need OCR before AI analysis.');
    return {
      name: file.name,
      size: file.size,
      fileType: 'pdf',
      fileTypeLabel: 'PDF Document',
      icon: 'picture_as_pdf',
      mimeType: 'text/plain',
      content
    };
  }

  // 2. PowerPoint Presentation (.pptx)
  if (fileName.endsWith('.pptx')) {
    return await parsePptxFile(file);
  }

  // 3. Word Document (.docx)
  if (fileName.endsWith('.docx')) {
    return await parseDocxFile(file);
  }

  // 4. Legacy .ppt (PowerPoint 97-2003)
  if (fileName.endsWith('.ppt')) {
    throw new Error('Older .ppt format is binary. Please save or export your presentation as .pptx or .pdf for full analysis.');
  }

  // 5. Text / Code / Markdown / CSV files
  const textContent = await readFileAsText(file);
  let fileTypeLabel = 'Text Document';
  let icon = 'description';

  if (fileName.endsWith('.md')) {
    fileTypeLabel = 'Markdown Document';
    icon = 'menu_book';
  } else if (fileName.endsWith('.csv')) {
    fileTypeLabel = 'CSV Spreadsheet';
    icon = 'table_chart';
  } else if (fileName.endsWith('.json')) {
    fileTypeLabel = 'JSON Data';
    icon = 'data_object';
  } else if (/\.(js|jsx|ts|tsx|py|sql|html|css)$/.test(fileName)) {
    fileTypeLabel = 'Source Code';
    icon = 'code';
  }

  return {
    name: file.name,
    size: file.size,
    fileType: 'text',
    fileTypeLabel,
    icon,
    mimeType: 'text/plain',
    content: textContent
  };
}
