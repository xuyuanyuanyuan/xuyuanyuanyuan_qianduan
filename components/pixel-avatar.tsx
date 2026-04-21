"use client"

import {
  BRAND_NAME,
  BRANDING_ASSETS,
} from "@/lib/branding"

interface PixelAvatarProps {
  type: "robot" | "user"
  size?: number
}

export function PixelAvatar({ type, size = 48 }: PixelAvatarProps) {
  if (type === "robot") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        className="pixel-avatar"
        style={{ imageRendering: "pixelated" }}
      >
        <rect width="48" height="48" fill="#f8fafc" />
        <rect x="8" y="14" width="32" height="8" fill="#fbbf24" />
        <rect x="10" y="20" width="28" height="6" fill="#fde68a" />
        <rect x="16" y="26" width="16" height="14" fill="#cbd5e1" />
        <rect x="14" y="30" width="6" height="6" fill="#0f172a" />
        <rect x="28" y="30" width="6" height="6" fill="#0f172a" />
        <rect x="20" y="36" width="8" height="2" fill="#475569" />
        <rect x="14" y="24" width="20" height="6" fill="#f59e0b" />
        <rect x="8" y="20" width="4" height="10" fill="#94a3b8" />
        <rect x="36" y="20" width="4" height="10" fill="#94a3b8" />
        <rect x="18" y="10" width="12" height="2" fill="#f59e0b" />
        <rect x="16" y="12" width="16" height="2" fill="#fcd34d" />
        <rect x="12" y="22" width="24" height="2" fill="#fbbf24" />
        <rect x="10" y="16" width="28" height="4" fill="#f59e0b" />
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className="pixel-avatar"
      style={{ imageRendering: "pixelated" }}
    >
      <circle cx="24" cy="24" r="24" fill="#3b82f6" />
      <rect x="12" y="8" width="24" height="4" fill="#fbbf24" />
      <rect x="10" y="12" width="28" height="3" fill="#fbbf24" />
      <rect x="8" y="15" width="32" height="2" fill="#f59e0b" />
      <rect x="22" y="6" width="4" height="2" fill="#fbbf24" />
      <rect x="14" y="17" width="20" height="14" fill="#fcd9b6" />
      <rect x="17" y="21" width="4" height="4" fill="#1e293b" />
      <rect x="27" y="21" width="4" height="4" fill="#1e293b" />
      <rect x="17" y="21" width="2" height="2" fill="#64748b" />
      <rect x="27" y="21" width="2" height="2" fill="#64748b" />
      <rect x="20" y="27" width="8" height="2" fill="#c9a67a" />
      <rect x="14" y="33" width="20" height="10" fill="#1e293b" />
      <rect x="22" y="33" width="4" height="8" fill="#3b82f6" />
    </svg>
  )
}

export function PixelLogo({ size = 40 }: { size?: number }) {
  return (
    <div
      className="overflow-hidden rounded border border-border bg-white shadow-sm"
      style={{ width: size, height: size }}
    >
      <img
        src={BRANDING_ASSETS.logoMain}
        alt={`${BRAND_NAME} 标识`}
        className="h-full w-full object-contain p-1"
      />
    </div>
  )
}
