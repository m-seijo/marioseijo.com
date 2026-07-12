# marioseijo.com

Source for [marioseijo.com](https://marioseijo.com), my personal site and a public case study in building a strategy-first web presence.

This repo contains the implementation: a static Vite site built with vanilla JavaScript, CSS, and a small Three.js enhancement layer. The strategy notes, content drafts, deployment operations, and private working brief live outside this public repo.

## What This Is

- A static personal site and digital business card.
- A build-in-the-open artifact for Minimo Studio's strategy-first website process.
- A small front-end codebase focused on real HTML content, accessible interactions, and a polished responsive card interface.

## Stack

- Vite
- Vanilla JavaScript
- CSS
- Three.js
- Self-hosted fonts
- Static output served from `dist/`

## Local Development

Requires Node 24.

```bash
npm install
npm run dev
```

Build the static site:

```bash
npm run build
```

Preview the built output:

```bash
npm run preview
```

## Project Structure

```text
index.html            # Home route
privacy/index.html    # Privacy route
src/                  # CSS and JavaScript source
public/               # Static root files copied into dist/
vite.config.js        # Static build configuration
```

## Notes

The site is intentionally static. There is no backend, no database, and no runtime environment configuration.

The downloadable contact file at `/mario-seijo.vcf` should be served as `text/vcard; charset=utf-8` in production so mobile devices recognize it as a contact card.

## License

MIT
