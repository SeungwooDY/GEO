/**
 * How a tenant's site is presented to AI crawlers:
 *  - amplify: the clearest, most complete generated version (must pass the validation gate)
 *  - mirror:  exactly what a person sees (rendered snapshot, no restructuring)
 *  - cloak:   AI crawlers are blocked and nothing is served
 * Note: "cloak" here means honest blocking, not the deceptive bot-vs-human cloaking the policy in PLAN.md forbids.
 */
export type DeliveryMode = 'amplify' | 'mirror' | 'cloak';

export const DELIVERY_MODES: readonly DeliveryMode[] = ['amplify', 'mirror', 'cloak'];
