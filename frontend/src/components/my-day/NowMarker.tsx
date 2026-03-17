/** Horizontal "NOW" line that floats at the current time position. */
interface NowMarkerProps {
  topPx: number
}

export default function NowMarker({ topPx }: NowMarkerProps) {
  return (
    <div
      className="absolute left-0 right-0 flex items-center pointer-events-none z-20"
      style={{ top: topPx }}
    >
      <span className="text-[11px] font-bold text-orange-500 bg-white px-1 rounded shrink-0 leading-none select-none">
        NOW
      </span>
      <div className="flex-1 h-[2px] bg-orange-400 rounded-full" />
    </div>
  )
}
