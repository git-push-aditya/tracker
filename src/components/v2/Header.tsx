import { Button } from "./ui/button";
import { Logo } from "./ui";
export function Header({ todayLabel, todayIso, canEdit }: {
  todayLabel: string; todayIso: string; canEdit: boolean;
}) {
  return (
    <header className="top">
      <div className="brand">
        <div>
          <h1 className="sr-only">Prime Care</h1>
          <div className="logo" style={{ justifyItems: "start" }}><Logo height={56} /></div>
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
