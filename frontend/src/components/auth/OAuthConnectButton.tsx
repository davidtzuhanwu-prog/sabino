import { useGoogleAuth } from '../../hooks/useGoogleAuth'

export default function OAuthConnectButton() {
  const { status, loading, connect, disconnect } = useGoogleAuth()

  if (loading) return <span className="text-slate-400">Checking connection...</span>

  if (status.connected) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-emerald-600 font-medium text-[15px]">✅ Connected as {status.email}</span>
        <button
          className="bg-transparent border border-red-400 text-red-400 rounded-md px-3 py-1.5 cursor-pointer text-[13px] min-h-[44px]"
          onClick={disconnect}
        >Disconnect</button>
      </div>
    )
  }

  return (
    <button
      className="flex items-center bg-white border border-gray-300 rounded-lg px-5 py-2.5 cursor-pointer font-semibold text-[15px] text-gray-700 shadow-sm hover:shadow-md transition-shadow min-h-[44px]"
      onClick={connect}
    >
      <GoogleIcon />
      Connect Google Account
    </button>
  )
}

function GoogleIcon() {
  return <span className="text-lg mr-2">G</span>
}
