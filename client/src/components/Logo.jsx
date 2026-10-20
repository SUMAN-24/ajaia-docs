export default function Logo({ small = false }) {
  return (
    <span className={`logo ${small ? "logo-small" : ""}`}>
      <svg viewBox="0 0 32 32" width={small ? 24 : 32} height={small ? 24 : 32} aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="currentColor" />
        <path d="M10 8h9l4 4v12H10z" fill="white" />
        <path d="M13 15h7M13 18.5h7M13 22h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>Ajaia Docs</span>
    </span>
  );
}
