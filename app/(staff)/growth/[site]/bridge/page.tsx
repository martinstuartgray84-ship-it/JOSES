import { db } from "@/src/server/db";
import { getBridge } from "@/src/server/growth-programme";
import { annualBase, bridgeDefaults, moneyK, summary } from "@/src/growth/engine";
import BridgeEditor from "../../BridgeEditor";
import { growthCtx, type SP } from "../../ctx";
import { Head } from "../../ui";

export default async function BridgePage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/bridge");
  const base = c.model && c.period ? annualBase(summary(c.model, c.period.from, c.period.to).salesPerWeek) : 0;
  const defaults = bridgeDefaults(base);
  const saved = await getBridge(db(), c.site.id);
  const initial = { ...defaults, ...(saved ?? {}) };
  return (
    <>
      <Head title="Revenue model">The model of how this site gets from today&rsquo;s sales to the target: what each move is assumed to add. Change any assumption and the path redraws. Replace assumptions with measured results as tests and pilots report.</Head>
      <BridgeEditor
        key={JSON.stringify(initial)}
        slug={slug}
        initial={initial}
        defaults={defaults}
        saved={!!saved}
        baseNote={base ? `The starting figure is the selected period annualised, ${moneyK(base)}, until you overwrite it.` : "Load till data to start from your own annual sales."}
      />
    </>
  );
}
