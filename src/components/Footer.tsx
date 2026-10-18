export function Footer({ demo }: { demo: boolean }) {
  return (
    <footer>
      {demo ? (
        <>
          Changes are kept in this session only. Use Export JSON to back up or share.
          {" · "}<button className="btn ghost sm" type="button" id="btnReset">Reset to sample data</button>
        </>
      ) : (
        <>Changes are saved to the shared database. Use Export JSON to back up or share.</>
      )}
    </footer>
  );
}
