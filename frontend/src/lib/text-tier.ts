/**
 * Text size tier, like Apple's Dynamic Type categories. The root font size is measured and written to
 * `<html data-text="std|lg|xl|ax">`; layouts that cannot simply wrap switch on it (see ui/tiers.css).
 * std: up to 115 % of the default · lg: to 150 % · xl: to 200 % · ax: accessibility sizes, 200 % and up.
 * The same code runs inline in the document head (so the first paint is right) and from <TextTier /> afterwards.
 */
export const TIER_SCRIPT = `(function(){var d=document.documentElement;function s(){try{var b=window.CSS&&CSS.supports&&CSS.supports('font','-apple-system-body')?17:16;var r=parseFloat(getComputedStyle(d).fontSize)/b;var t=r<1.15?'std':r<1.5?'lg':r<2?'xl':'ax';if(d.dataset.text!==t)d.dataset.text=t}catch(e){}}s();addEventListener('resize',s);addEventListener('focus',s);addEventListener('pageshow',s);document.addEventListener('visibilitychange',s)})()`;
