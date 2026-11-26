// Keep spaces between non-ASCII words in the same directional run.
const nonAsciiRuns = /((?:\p{ASCII}(?=\p{M}))?\P{ASCII}+(?: +\P{ASCII}+)*)/gu;

export function Filename({ name }: { name: string }) {
  const stem = name.slice(0, -4);

  return (
    <bdi dir="ltr" className="filename" title={name}>
      <span className="filename-stem">{stem.split(nonAsciiRuns).map((run, index) =>
        index % 2 ? <bdi key={index} dir="auto">{run}</bdi> : run,
      )}</span><span className="filename-extension">{name.slice(-4)}</span>
    </bdi>
  );
}
