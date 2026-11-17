import bwip from 'bwip-js/node'

export const qrSvg = (text: string, scale = 3) =>
  bwip.toSVG({ bcid: 'qrcode', text, scale, paddingwidth: 1, paddingheight: 1, backgroundcolor: 'FFFFFF', eclevel: 'M' } as any)

export const code128Svg = (text: string) =>
  bwip.toSVG({ bcid: 'code128', text, scale: 2, height: 8, includetext: true, textxalign: 'center', textsize: 8, backgroundcolor: 'FFFFFF' } as any)
