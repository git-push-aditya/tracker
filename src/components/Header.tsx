import { Logo } from "./ui";
export function ThemeButton({ label = "Theme: System" }: { label?: string }) {
  return <button className="btn" id="btnTheme" type="button" aria-label="Change colour theme">{label}</button>;
}

export function UserMenu({ username, role }: { username: string; role: string }) {
  return (
    <span className="user-menu">
      <span className="badge b-ns">{role}</span>
      {username}
      <button className="btn sm" type="button" id="btnLogout">Log out</button>
    </span>
  );
}

export function Header({ todayLabel, todayIso, canEdit, user, themeLabel }: {
  todayLabel: string; todayIso: string; canEdit: boolean; user?: { username: string; role: string }; themeLabel?: string;
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
        {canEdit && <button className="btn primary" id="btnAddTask" type="button">+ Add task</button>}
        <button className="btn" id="btnExport" type="button">Export JSON</button>
        {canEdit && (
          <>
            <button className="btn" id="btnImport" type="button">Import JSON</button>
            <input type="file" id="fileImport" accept="application/json,.json" hidden />
          </>
        )}
        <ThemeButton label={themeLabel} />
        {user && <UserMenu {...user} />}
      </div>
    </header>
  );
}
