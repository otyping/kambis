/** ui/icons.js — ไอคอนเส้น (inline SVG) ของการ์ดแต่ละใบ */

const PATHS = {
  overview: '<path d="M3 13h4l3 7 4-16 3 9h4"/>',
  daily:
    '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 15h2M14 15h2"/>',
  crop: '<path d="M12 21V9"/><path d="M12 9c0-3.5 2.4-6.4 6-7-.2 3.8-2.6 6.4-6 7Z"/><path d="M12 12c-3.4-.6-5.8-3.2-6-7 3.6.6 6 3.5 6 7Z"/>',
  truck:
    '<path d="M3 16V6a1 1 0 0 1 1-1h10v11"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
  inbox:
    '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14l2 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z"/>',
  sales:
    '<path d="M3 3h2l2.6 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  stock:
    '<path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 16.5 12 21l9-4.5"/>',
  quality:
    '<path d="M12 3 4 6.5v5c0 4.6 3.2 8.6 8 9.5 4.8-.9 8-4.9 8-9.5v-5L12 3Z"/><path d="m9 12 2 2 4-4"/>',
};

export function icon(name) {
  const body = PATHS[name] || PATHS.overview;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
