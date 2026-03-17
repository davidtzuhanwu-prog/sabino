interface ProgressFooterProps {
  total: number
  completed: number
}

export default function ProgressFooter({ total, completed }: ProgressFooterProps) {
  if (total === 0) return null

  const allDone = completed === total
  const pct = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm px-5 py-4 mt-4">
      {allDone ? (
        <div className="flex flex-col items-center gap-1">
          <span className="text-3xl">🌟</span>
          <p className="font-bold text-gray-800 text-lg text-center">You did it! All done for today!</p>
        </div>
      ) : (
        <>
          <p className="text-gray-700 font-semibold text-base mb-2">
            {completed} of {total} done — keep going!
          </p>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, #FF922B, #F03868)',
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
