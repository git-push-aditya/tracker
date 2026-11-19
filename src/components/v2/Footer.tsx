export function Footer({ demo }: { demo: boolean }) {
  return (
    <footer>
      {demo ? (
        <>
          Changes are kept in this session only. Export a backup from Settings.
          {" · "}<button className="btn ghost sm" type="button" id="btnReset">Reset to sample data</button>
        </>
      ) : (
        <>Changes are saved to the shared database. Export a backup from Settings.</>
      )}
    </footer>
  );
}
