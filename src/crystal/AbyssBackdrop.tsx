// Abyss backdrop — three slowly-drifting caustic light shapes over a
// deep-ocean gradient, plus a very faint noise dust layer. Fixed in the
// viewport so scrolling never affects it. Purely decorative; pointer
// events off; sits at z-index 0 with content on z-index 1+.
export function AbyssBackdrop() {
  return (
    <div className="cr-abyss" aria-hidden="true">
      <div className="cr-caustic a" />
      <div className="cr-caustic b" />
      <div className="cr-caustic c" />
      <div className="cr-noise" />
    </div>
  );
}
