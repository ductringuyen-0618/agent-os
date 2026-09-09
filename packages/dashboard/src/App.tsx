export default function App() {
  return (
    <div className="flex h-screen bg-background text-text">
      <nav
        aria-label="agent-os"
        className="w-56 shrink-0 border-r border-border bg-surface p-4"
      >
        <div className="font-mono text-sm text-accent">agent-os</div>
      </nav>
      <main className="flex-1 overflow-auto p-6" />
    </div>
  );
}
