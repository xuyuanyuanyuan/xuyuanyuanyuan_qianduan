"use client"

interface PixelAvatarProps {
  type: "robot" | "user"
  size?: number
}

export function PixelAvatar({ type, size = 48 }: PixelAvatarProps) {
  if (type === "robot") {
    // 统一的AI机器人头像 - 戴黄色安全帽的像素机器人
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        className="pixel-avatar"
        style={{ imageRendering: 'pixelated' }}
      >
        {/* 蓝色圆形背景 */}
        <circle cx="24" cy="24" r="24" fill="#3b82f6" />
        
        {/* 黄色安全帽 */}
        <rect x="12" y="8" width="24" height="4" fill="#fbbf24" />
        <rect x="10" y="12" width="28" height="3" fill="#fbbf24" />
        <rect x="8" y="15" width="32" height="2" fill="#f59e0b" />
        
        {/* 帽子顶部装饰 */}
        <rect x="22" y="6" width="4" height="2" fill="#fbbf24" />
        
        {/* 机器人头部 - 白色方形 */}
        <rect x="14" y="17" width="20" height="14" fill="#ffffff" />
        
        {/* 眼睛 - 像素方块 */}
        <rect x="17" y="21" width="4" height="4" fill="#1e293b" />
        <rect x="27" y="21" width="4" height="4" fill="#1e293b" />
        
        {/* 眼睛高光 */}
        <rect x="17" y="21" width="2" height="2" fill="#64748b" />
        <rect x="27" y="21" width="2" height="2" fill="#64748b" />
        
        {/* 嘴巴 - 栅格 */}
        <rect x="18" y="27" width="12" height="2" fill="#3b82f6" />
        <rect x="20" y="27" width="2" height="2" fill="#ffffff" />
        <rect x="24" y="27" width="2" height="2" fill="#ffffff" />
        <rect x="28" y="27" width="2" height="2" fill="#ffffff" />
        
        {/* 身体 */}
        <rect x="16" y="33" width="16" height="8" fill="#ffffff" />
        
        {/* 身体中心指示灯 */}
        <rect x="22" y="35" width="4" height="4" fill="#22c55e" />
      </svg>
    )
  }

  // 用户头像 - 戴黄色安全帽的工程师
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className="pixel-avatar"
      style={{ imageRendering: 'pixelated' }}
    >
      {/* 蓝色圆形背景 */}
      <circle cx="24" cy="24" r="24" fill="#3b82f6" />
      
      {/* 黄色安全帽 */}
      <rect x="12" y="8" width="24" height="4" fill="#fbbf24" />
      <rect x="10" y="12" width="28" height="3" fill="#fbbf24" />
      <rect x="8" y="15" width="32" height="2" fill="#f59e0b" />
      
      {/* 帽子顶部装饰 */}
      <rect x="22" y="6" width="4" height="2" fill="#fbbf24" />
      
      {/* 脸部 - 肤色方块 */}
      <rect x="14" y="17" width="20" height="14" fill="#fcd9b6" />
      
      {/* 眼睛 */}
      <rect x="17" y="21" width="4" height="4" fill="#1e293b" />
      <rect x="27" y="21" width="4" height="4" fill="#1e293b" />
      
      {/* 眼睛高光 */}
      <rect x="17" y="21" width="2" height="2" fill="#64748b" />
      <rect x="27" y="21" width="2" height="2" fill="#64748b" />
      
      {/* 嘴巴 */}
      <rect x="20" y="27" width="8" height="2" fill="#c9a67a" />
      
      {/* 身体/衣服 */}
      <rect x="14" y="33" width="20" height="10" fill="#1e293b" />
      
      {/* 领带 */}
      <rect x="22" y="33" width="4" height="8" fill="#3b82f6" />
    </svg>
  )
}

// Logo版本的机器人头像 - 用于侧边栏
export function PixelLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ imageRendering: 'pixelated' }}
    >
      {/* 绿色背景 */}
      <rect width="40" height="40" fill="#22c55e" rx="4" />
      
      {/* 黄色安全帽 */}
      <rect x="10" y="4" width="20" height="3" fill="#fbbf24" />
      <rect x="8" y="7" width="24" height="2" fill="#fbbf24" />
      <rect x="6" y="9" width="28" height="2" fill="#f59e0b" />
      
      {/* 帽子顶部 */}
      <rect x="18" y="2" width="4" height="2" fill="#fbbf24" />
      
      {/* 机器人头部 */}
      <rect x="11" y="11" width="18" height="12" fill="#ffffff" />
      
      {/* 眼睛 */}
      <rect x="14" y="14" width="4" height="4" fill="#1e293b" />
      <rect x="22" y="14" width="4" height="4" fill="#1e293b" />
      
      {/* 眼睛高光 */}
      <rect x="14" y="14" width="2" height="2" fill="#64748b" />
      <rect x="22" y="14" width="2" height="2" fill="#64748b" />
      
      {/* 嘴巴 */}
      <rect x="15" y="20" width="10" height="2" fill="#22c55e" />
      <rect x="17" y="20" width="2" height="2" fill="#ffffff" />
      <rect x="21" y="20" width="2" height="2" fill="#ffffff" />
      
      {/* 身体 */}
      <rect x="13" y="25" width="14" height="8" fill="#ffffff" />
      
      {/* 指示灯 */}
      <rect x="18" y="27" width="4" height="4" fill="#22c55e" />
    </svg>
  )
}
