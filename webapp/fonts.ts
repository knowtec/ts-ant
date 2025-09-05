// app/fonts.ts
import localFont from 'next/font/local';

export const robotoSlab = localFont({
  src: [
    { path: './public/fonts/roboto-slab/RobotoSlab-ExtraLight.ttf', weight: '200', style: 'normal' },
    { path: './public/fonts/roboto-slab/RobotoSlab-Light.ttf',      weight: '300', style: 'normal' },
    { path: './public/fonts/roboto-slab/RobotoSlab-Regular.ttf',    weight: '400', style: 'normal' },
    { path: './public/fonts/roboto-slab/RobotoSlab-Medium.ttf',     weight: '500', style: 'normal' },
    { path: './public/fonts/roboto-slab/RobotoSlab-SemiBold.ttf',   weight: '600', style: 'normal' },
    { path: './public/fonts/roboto-slab/RobotoSlab-Bold.ttf',       weight: '700', style: 'normal' },
    { path: './public/fonts/roboto-slab/RobotoSlab-ExtraBold.ttf',  weight: '800', style: 'normal' },
    { path: './public/fonts/roboto-slab/RobotoSlab-Black.ttf',      weight: '900', style: 'normal' },
  ],
  variable: '--font-roboto-slab',
  display: 'swap',
});

export const archivo = localFont({
  src: [
    { path: './public/fonts/archivo/Archivo-Regular.ttf', weight: '400', style: 'normal' },
    { path: './public/fonts/archivo/Archivo-Bold.ttf', weight: '500', style: 'normal' },  ],
  variable: '--font-body',
  display: 'swap',
});
