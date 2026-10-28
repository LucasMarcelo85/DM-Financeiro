import { useId } from 'react';

export default function InfinitePayMark() {
  const gradientId = `infinitepay-gradient-${useId().replace(/:/g, '')}`;
  return (
    <span className="cs-infinitepay-brand" aria-label="InfinitePay">
      <svg viewBox="0 0 48 32" aria-hidden="true">
        <path d="M17 7C9 7 4 12 4 16s5 9 13 9c5 0 8-3 11-9s6-9 12-9" fill="none" stroke={`url(#${gradientId})`} strokeWidth="5" strokeLinecap="round" />
        <path d="M31 7c8 0 13 5 13 9s-5 9-13 9c-5 0-8-3-11-9s-6-9-12-9" fill="none" stroke={`url(#${gradientId})`} strokeWidth="5" strokeLinecap="round" />
        <defs><linearGradient id={gradientId} x1="4" y1="16" x2="44" y2="16" gradientUnits="userSpaceOnUse"><stop stopColor="#6750E8" /><stop offset="1" stopColor="#13B8A6" /></linearGradient></defs>
      </svg>
      <strong>InfinitePay</strong>
    </span>
  );
}
