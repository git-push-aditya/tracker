import { Button } from "./ui/button";
import { Logo } from "./ui";
export function Header({ todayLabel, todayIso, canEdit }: {
  todayLabel: string; todayIso: string; canEdit: boolean;
}) {
  return (
    <header className="top">
      <div className="brand">
        <div className="logo" aria-hidden="true">
          <Logo />
        </div>
        <div>
          <h1>Prime Care</h1>
          <div className="sub">Product Progress Dashboard · <time id="todayLabel" dateTime={todayIso}>{todayLabel}</time></div>
        </div>
      </div>
      <div className="actions">
        {canEdit && <Button id="btnAddTask" type="button">+ Add task</Button>}
        <Button variant="outline" id="btnExport" type="button">Export JSON</Button>
        {canEdit && (
          <>
            <Button variant="outline" id="btnImport" type="button">Import JSON</Button>
            <input type="file" id="fileImport" accept="application/json,.json" hidden />
          </>
        )}
      </div>
    </header>
  );
}
