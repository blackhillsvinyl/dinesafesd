// South Dakota outline (projected from the state's border polygon) with the
// safety check — the DineSafeSD mark.
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.636}
      viewBox="0 0 100 63.6"
      aria-hidden
      focusable="false"
    >
      <path
        d="M0.1 0.0L98.3 0.2L98.1 2.3L94.5 6.2L96.8 9.8L99.8 11.9L99.8 44.9L98.1 45.3L98.8 46.8L98.3 50.1L100.0 51.9L99.0 53.2L98.6 56.8L97.4 59.5L99.9 63.6L97.5 63.1L96.6 60.4L89.7 57.0L83.5 57.0L81.7 56.6L80.1 58.4L73.3 55.1L72.9 54.2L31.9 54.2L9.6 54.1L0.1 54.1L0.0 17.4L0.2 17.4L0.1 0.0Z"
        fill="#15803d"
      />
      <path
        d="M35 32 L46 43 L66 20"
        fill="none"
        stroke="#fff"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
