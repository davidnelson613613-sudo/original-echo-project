import { CrystalRoot } from "./CrystalRoot";
import { CrystalSlab, MicroLabel, Serif } from "./primitives";
import { Link } from "@tanstack/react-router";

// Floating placeholder for pages not yet rebuilt in crystal.
export function ComingSoon({ page }: { page: string }) {
  return (
    <CrystalRoot>
      <div className="mx-auto flex min-h-[85vh] max-w-3xl items-center px-6">
        <CrystalSlab rise className="w-full p-10 sm:p-14 text-center">
          <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-white/5 cr-halo">
            <span className="text-2xl">◈</span>
          </div>
          <MicroLabel>Crystal · in construction</MicroLabel>
          <Serif className="mt-3 block text-3xl sm:text-4xl text-white">
            {page} is being sculpted
          </Serif>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/60">
            The scanner and every alert continues to run underneath. The
            crystal surface for this page is on the way.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/" className="cr-pill" data-active="true">
              Back to Terminal
            </Link>
          </div>
        </CrystalSlab>
      </div>
    </CrystalRoot>
  );
}
