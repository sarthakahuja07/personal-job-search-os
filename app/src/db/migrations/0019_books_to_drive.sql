-- The books move to Google Drive.
--
-- They were PDFs under `app/public/books/`, deliberately gitignored because they are paid
-- books. That made them invisible to any deploy that did not run from the laptop holding
-- them -- GitHub Actions checks out a tree without the files, ships an assets directory
-- without them, and every book 404s. Volume 2 could not have worked from `public/` in any
-- case: the Drive copy is 97 MB and Workers refuses a static asset over 25 MiB.
--
-- Matched on `slug`, not on the old `content.pdf` path. The slug is the page's stable
-- identity -- it is in the URL -- whereas the pdf path is incidental data that a page may not
-- carry at all, and matching on it silently updates nothing when it differs by a character.
--
-- `pdf` is left in place rather than replaced. It costs nothing, it records where the file
-- used to come from, and the reader prefers `drive` when both are present.

UPDATE prep_items
SET content = json_set(COALESCE(content, '{}'), '$.drive', '1RelBYYeUJo7q8ehyDLzMx37j6LlmOf1W')
WHERE slug = 'system-design-interview-vol-1';
--> statement-breakpoint
UPDATE prep_items
SET content = json_set(COALESCE(content, '{}'), '$.drive', '1zrN3xxzOqf-qWznOjOSmzcFFuSMTDxoX')
WHERE slug = 'system-design-interview-vol-2';
--> statement-breakpoint
UPDATE prep_items
SET content = json_set(COALESCE(content, '{}'), '$.drive', '1rbHjwHfOnPe8V4IpBSQsbI0OrqChynNe')
WHERE slug = 'designing-data-intensive-applications';
