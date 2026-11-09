import { apiOf } from "../registry";

/** The props of one export, generated from the TypeScript by scripts/build-library.mjs. Never written by hand. */
export function PropsTable({ name }: { name: string }) {
  const a = apiOf[name];
  if (!a) return null;
  return (
    <section className="lib-api" aria-labelledby={`api-${name}`}>
      <h3 id={`api-${name}`}><code>{name}</code> <small className="lib-kind">{a.kind}</small></h3>
      {a.description ? <p className="lib-lede">{a.description}</p> : null}
      {a.props.length ? (
        <div className="lib-scroll"><table className="lib-table">
          <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
          <tbody>{a.props.map((p) => (
            <tr key={p.name}>
              <td><code>{p.name}</code>{p.required ? <span className="lib-req" title="Required"> *</span> : null}</td>
              <td><code className="lib-type">{p.type}</code></td>
              <td>{p.default ? <code>{p.default}</code> : <span className="lib-dash">–</span>}</td>
              <td>{p.description}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : a.kind === "component" ? <p className="lib-note">Takes no props of its own.</p> : null}
      {a.inherits.length ? <p className="lib-note">Also accepts {a.inherits.map((i, n) => <span key={i}>{n ? ", " : ""}<code>{i.startsWith("@") ? i : `<${i}>`}</code></span>)} props, and passes them through.</p> : null}
    </section>
  );
}
