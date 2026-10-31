// A whole number of screen pixels per module, never fewer than `px` in total: a module that lands on
// half a pixel blurs, and a phone camera needs sharp edges — most of all on the dense backup address.
// `size` is the QR's module count including its quiet zone (qr.ts).
export const qrSide = (size: number, px: number) => size * Math.ceil(px / size);
