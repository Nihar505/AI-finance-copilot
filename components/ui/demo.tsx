import GatewayFlow from "@/components/ui/gateway-flow";

export default function GatewayFlowDemo() {
  return (
    <div
      className="relative h-[520px] w-full overflow-hidden rounded-xl border border-border bg-black"
      style={{
        position: 'relative',
        height: '520px',
        width: '100%',
        overflow: 'hidden',
        borderRadius: '12px',
        border: '1px solid var(--border, #27272a)',
        background: '#000000'
      }}
    >
      <GatewayFlow className="h-full w-full" style={{ width: '100%', height: '100%', border: 0 }} />
    </div>
  );
}
