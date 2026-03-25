import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import ForceGraph2D from "react-force-graph-2d";

const API = "http://localhost:3000";

const NODE_COLORS = {
  1: { bg: "#4a90d9", label: "Sales Order" },
  2: { bg: "#5ba85a", label: "Delivery" },
  3: { bg: "#e07b3a", label: "Invoice" },
  4: { bg: "#d94a4a", label: "Journal Entry" },
};

export default function App() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi! I can help you analyze the Order to Cash process." },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const chatEndRef = useRef(null);
  const rawData = useRef({ orders: [], deliveries: [], invoices: [], journals: [] });

  useEffect(() => { fetchGraph(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const fetchGraph = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/graph`);
      const { orders, deliveries, invoices, journals } = res.data;
      rawData.current = { orders, deliveries, invoices, journals };
      // null = show all connections (no expand filter)
      buildGraph(orders, deliveries, invoices, journals, null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Confirmed field mapping from your Prisma schema:
  //   Order.id                  ←→ Delivery.salesOrderReference
  //   Delivery.deliveryId       ←→ Invoice.deliveryReference
  //   Invoice.billingDocumentId ←→ Journal.invoiceReference
  const buildGraph = (orders, deliveries, invoices, journals, expanded) => {
    const nodes = [];
    const links = [];
    const addedNodes = new Set();

    const addNode = (id, group, label) => {
      if (!addedNodes.has(id)) {
        addedNodes.add(id);
        nodes.push({ id, group, label });
      }
    };

    // ORDERS
    orders.slice(0, 200).forEach((o) => {
      addNode("O-" + o.id, 1, "Order " + o.id);
    });

    // DELIVERY → ORDER
    deliveries.forEach((d) => {
      const dId = "D-" + d.deliveryId;
      const oId = "O-" + d.salesOrderReference;

      if (!addedNodes.has(oId)) return;

      addNode(dId, 2, "Delivery " + d.deliveryId);

      links.push({
        source: oId,
        target: dId,
      });
    });

    // INVOICE → DELIVERY
    invoices.forEach((i) => {
      const iId = "I-" + i.billingDocumentId;
      const dId = "D-" + i.deliveryReference;

      if (!addedNodes.has(dId)) return;

      addNode(iId, 3, "Invoice " + i.billingDocumentId);

      links.push({
        source: dId,
        target: iId,
      });
    });

    // JOURNAL → INVOICE
    journals.forEach((j) => {
      const jId = "J-" + j.id;
      const iId = "I-" + j.invoiceReference;

      if (!addedNodes.has(iId)) return;

      addNode(jId, 4, "Journal " + j.id);

      links.push({
        source: iId,
        target: jId,
      });
    });

    setGraphData({ nodes, links });
  };


  const handleNodeClick = (node) => {
    setSelectedNode(node);

    // Only expand for Orders
    if (node.group !== 1) return;

    const orderId = node.id.replace("O-", "");

    const { orders, deliveries, invoices, journals } = rawData.current;

    // Filter data ONLY for this order
    const filteredDeliveries = deliveries.filter(
      (d) => d.salesOrderReference === orderId
    );

    const deliveryIds = filteredDeliveries.map((d) => d.deliveryId);

    const filteredInvoices = invoices.filter((i) =>
      deliveryIds.includes(i.deliveryReference)
    );

    const invoiceIds = filteredInvoices.map((i) => i.billingDocumentId);

    const filteredJournals = journals.filter((j) =>
      invoiceIds.includes(j.invoiceReference)
    );

    // Build graph ONLY for this order
    buildGraph(
      orders.filter((o) => o.id === orderId),
      filteredDeliveries,
      filteredInvoices,
      filteredJournals,
      null
    );
  };


  const paintNode = useCallback((node, ctx, globalScale) => {
    const color = NODE_COLORS[node.group]?.bg || "#888";
    const isOrder = node.group === 1;
    const isExpanded = isOrder && expandedOrders.has(node._rawId || node.id?.replace("O-", ""));
    const isSelected = selectedNode?.id === node.id;
    const r = isOrder ? 5 : 3;

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
      ctx.fillStyle = color + "33";
      ctx.fill();
    }
    if (isExpanded) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (isOrder) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  }, [selectedNode, expandedOrders]);

  const handleSend = async () => {
    if (!input.trim() || chatLoading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const res = await axios.post(`${API}/chat`, { message: userMsg });
      setMessages((m) => [...m, { role: "assistant", text: res.data.response }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Error reaching server. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  };

  const skipKeys = new Set(["id", "group", "_type", "_rawId", "x", "y", "vx", "vy", "fx", "fy", "__indexColor"]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#f4f5f7" }}>

      {/* ── TOP NAV ── */}
      <div style={{ height: 44, background: "#fff", borderBottom: "1px solid #e2e4e9", display: "flex", alignItems: "center", padding: "0 16px", gap: 8, flexShrink: 0, zIndex: 10 }}>
        <button style={{ background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 16, padding: "4px 6px", borderRadius: 4 }}>☰</button>
        <span style={{ color: "#aaa", fontSize: 13 }}>Mapping</span>
        <span style={{ color: "#ccc", fontSize: 13 }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Order to Cash</span>
      </div>

      {/* ── BODY ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── GRAPH ── */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#eef1f5" }}>

          {loading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, background: "#eef1f5" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>Loading graph…</div>
                <div style={{ height: 3, width: 48, background: "#4a90d9", borderRadius: 2, animation: "lp 1s ease-in-out infinite" }} />
              </div>
            </div>
          )}
          <button
            onClick={() => {
              setExpandedOrders(new Set());  
              fetchGraph();                 
            }}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              padding: "6px 12px",
              background: "#000",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              zIndex: 10
            }}
          >
            Reset Graph
          </button>

          <ForceGraph2D
            graphData={graphData}

            nodeAutoColorBy="group"

            linkColor={() => "#999"}
            linkWidth={1.5}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.4}

            onNodeClick={handleNodeClick}
          />

          {/* Top-left controls */}
          <div style={{ position: "absolute", top: 14, left: 14, display: "flex", gap: 8, zIndex: 5 }}>
            <button style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 6, padding: "6px 13px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              ⊡ Minimize
            </button>
            <button
              onClick={() => setShowOverlay((v) => !v)}
              style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 6, padding: "6px 13px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
            >
              ◈ {showOverlay ? "Hide" : "Show"} Granular Overlay
            </button>
          </div>

          {/* Legend */}
          {showOverlay && (
            <div style={{ position: "absolute", bottom: 20, left: 16, background: "rgba(255,255,255,0.94)", borderRadius: 10, padding: "10px 14px", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", border: "1px solid #e2e4e9", zIndex: 5 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#aaa", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Node Types</div>
              {Object.entries(NODE_COLORS).map(([g, info]) => (
                <div key={g} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: info.bg }} />
                  <span style={{ fontSize: 12, color: "#555" }}>{info.label}</span>
                </div>
              ))}
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #f0f0f0", fontSize: 11, color: "#aaa" }}>
                Click blue node to expand flow
              </div>
            </div>
          )}

          {/* Node inspector */}
          {selectedNode && (
            <div style={{
              position: "absolute",
              right: 20,
              bottom: 20,
              width: 250,
              background: "#fff",
              borderRadius: 10,
              padding: 12,
              boxShadow: "0 2px 10px rgba(0,0,0,0.2)"
            }}>
              <h4>{selectedNode.label}</h4>

              <p><b>Type:</b> {selectedNode.group === 1 ? "Order" :
                selectedNode.group === 2 ? "Delivery" :
                  selectedNode.group === 3 ? "Invoice" :
                    "Journal"}</p>

              <p><b>ID:</b> {selectedNode.id}</p>

              <button onClick={() => setSelectedNode(null)}>Close</button>
            </div>
          )}
        </div>

        {/* ── CHAT SIDEBAR ── */}
        <div style={{ width: 310, background: "#fff", borderLeft: "1px solid #e2e4e9", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>Chat with Graph</div>
            <div style={{ fontSize: 12, color: "#aaa", marginTop: 1 }}>Order to Cash</div>
          </div>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #f7f7f7", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>D</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#222" }}>Dodge AI</div>
              <div style={{ fontSize: 11, color: "#aaa" }}>Graph Agent</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", gap: 8, justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "assistant" && (
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#1a1a2e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>D</div>
                )}
                <div style={{
                  maxWidth: "84%",
                  background: msg.role === "user" ? "#4a90d9" : "#f7f8fa",
                  color: msg.role === "user" ? "#fff" : "#222",
                  padding: "9px 13px",
                  borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
                  fontSize: 13, lineHeight: 1.55,
                  border: msg.role === "user" ? "none" : "1px solid #eee",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#1a1a2e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>D</div>
                <div style={{ background: "#f7f8fa", border: "1px solid #eee", padding: "10px 14px", borderRadius: "4px 14px 14px 14px", display: "flex", gap: 5, alignItems: "center" }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#4a90d9", animation: `bounce 1s ${i * 0.18}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: "7px 16px", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />
            <span style={{ fontSize: 11, color: "#999" }}>Dodge AI is awaiting instructions</span>
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid #e2e4e9", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Analyze anything"
              style={{ flex: 1, border: "1px solid #e2e4e9", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", background: "#fafafa", color: "#222", fontFamily: "inherit" }}
            />
            <button
              onClick={handleSend}
              disabled={chatLoading || !input.trim()}
              style={{ background: "#1a1a2e", border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: chatLoading || !input.trim() ? 0.4 : 1, transition: "opacity 0.15s", fontFamily: "inherit" }}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes lp {
          0% { width: 48px; opacity: 1; }
          50% { width: 20px; opacity: 0.4; }
          100% { width: 48px; opacity: 1; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
      `}</style>
    </div>
  );
}
