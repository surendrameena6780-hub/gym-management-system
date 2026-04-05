import React from 'react';

export default function GymVaultLogo({ size = 36, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Shield shape */}
      <path
        d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z"
        fill="url(#shieldGrad)"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="1.5"
      />
      {/* Inner shield highlight */}
      <path
        d="M32 8L12 18v14c0 12.4 8.64 24.04 20 27.6 11.36-3.56 20-15.2 20-27.6V18L32 8z"
        fill="url(#innerGrad)"
        opacity="0.35"
      />
      {/* Dumbbell */}
      <g transform="translate(32,34)" stroke="white" strokeWidth="3" strokeLinecap="round" fill="none">
        {/* Bar */}
        <line x1="-12" y1="0" x2="12" y2="0" />
        {/* Left weight */}
        <rect x="-16" y="-6" width="5" height="12" rx="1.5" fill="white" stroke="none" />
        {/* Right weight */}
        <rect x="11" y="-6" width="5" height="12" rx="1.5" fill="white" stroke="none" />
        {/* Left cap */}
        <rect x="-19" y="-4" width="3.5" height="8" rx="1" fill="white" opacity="0.7" stroke="none" />
        {/* Right cap */}
        <rect x="15.5" y="-4" width="3.5" height="8" rx="1" fill="white" opacity="0.7" stroke="none" />
      </g>
      {/* Star accent */}
      <circle cx="32" cy="20" r="2" fill="white" opacity="0.9" />
      <defs>
        <linearGradient id="shieldGrad" x1="8" y1="4" x2="56" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
        <linearGradient id="innerGrad" x1="12" y1="8" x2="52" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
