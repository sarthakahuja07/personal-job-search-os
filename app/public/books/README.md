# Books

**The PDFs now live in Google Drive, not here.** A book page carries a `drive` reference in its
`content` (a share link or file id) and the bytes are streamed through `/api/books/<page id>`.

## Why they moved

These files are gitignored -- they are paid books and the only legitimate copy is one you
bought, so they do not belong in a repository. That had a consequence nobody noticed until every
book 404'd in production: a deploy from GitHub Actions checks out a tree *without* the PDFs,
ships an assets directory without them, and serves nothing. The books only ever worked when the
deploy happened to run from the laptop that held the files, and the next CI deploy silently
undid it.

Volume 2 could not have worked from here in any case. The Drive copy is 97 MB and Cloudflare
Workers refuses a static asset over 25 MiB.

## What this costs

Drive will not hand an anonymous request a private file, and the Worker has no Google
credentials, so each file has to be shared **anyone with the link**. Anyone who learns the file
id can read the book. That is a genuine widening of access compared with a file that existed
only inside an Access-protected deployment, and it is why the id is resolved server-side and
never rendered into the page.

## Adding a book

1. Upload the PDF to Drive and set General access to **anyone with the link**.
2. Put the share link in the page's `content.drive`.

`content.pdf` still works and still reads from this directory, for anything small enough to
commit and not worth a Drive round trip. When a page has both, `drive` wins.
