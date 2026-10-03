# sign document

Open a PDF or a picture of a document, place a saved signature, draw on it or add text, and save a signed copy. Signatures can be drawn, typed or made from a photo of a signature on paper. Everything happens in the browser; documents are never stored or uploaded, only the signatures are saved locally.

It adds a picture of a signature, not a certified digital signature.

There's no PDF library. The tool has its own small one:

- `pdf.js`: reads PDF objects, cross-reference tables and streams, object streams, the common filters and the page tree
- `fonts.js`: maps PDF font codes to characters and widths, for an approximate text preview
- `render.js`: draws a page preview on a canvas (paths, colours, clipping, images, text drawn in a similar system font). Shadings, patterns and JPEG 2000, CCITT and JBIG2 images are skipped, and the page says so.
- `write.js`: saves what was added to each page as one transparent image, appended to the original file as an incremental update, so the original content is kept byte for byte. Damaged files without a usable cross-reference table are written out again in full. Pictures are saved as PNG or JPEG, or as a one-page PDF.
- `worker.js`: runs all of the above off the main thread; it's only loaded when a PDF is opened
- `sig.js`: signature and drawing helpers (trimming, turning a photo into ink, smoothing strokes)
- `app.js`: the page

Encrypted or password-protected PDFs aren't supported. Tests: `tests/unit/sign-document.test.js` and `tests/e2e/sign-document.spec.js`.
