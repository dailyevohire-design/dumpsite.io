'use client'
import { useState, useEffect, useCallback } from 'react'

const PAGE_CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --e950:#111010;--e900:#1c1a18;--e850:#262320;--e800:#342f2a;
  --e700:#53493e;--e600:#746859;--e500:#968877;--e400:#b5a594;
  --e300:#d1c5b6;--e200:#e5ddd2;--e150:#eee8df;--e100:#f5f1eb;--e50:#faf8f5;
  --w:#ffffff;--bk:#0a0908;
  --a600:#a87508;--a500:#c98b0a;--a400:#e4a41d;--a300:#f2be42;--a100:#fef5de;
  --g700:#2a6b38;--g500:#48a84c;--g400:#68c06c;--g100:#e6f4e7;
  --r500:#bf392b;
  --fd:'DM Serif Display',Georgia,serif;
  --fb:'Instrument Sans',-apple-system,sans-serif;
  --fm:'JetBrains Mono','SF Mono',monospace;
}
html{scroll-behavior:smooth}
body{font-family:var(--fb);background:var(--e50);color:var(--e900);line-height:1.6;overflow-x:hidden;-webkit-font-smoothing:antialiased}
.mw{max-width:1180px;margin:0 auto;padding:0 24px}

/* ===== NAV ===== */
.nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:0 24px;transition:all .35s}
.nav.s{background:rgba(17,16,16,.97);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 1px 0 rgba(255,255,255,.03)}
.ni{max-width:1180px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:68px}
.nl{font-family:var(--fm);font-size:17px;font-weight:700;color:var(--w);text-decoration:none;letter-spacing:-.3px}
.nl i{font-style:normal;color:var(--a400)}
.nk{display:flex;align-items:center;gap:28px;list-style:none}
.nk a{color:rgba(255,255,255,.6);text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.3px;transition:color .2s}
.nk a:hover{color:var(--w)}
.nk-cta{background:var(--a400)!important;color:var(--e950)!important;padding:9px 20px!important;border-radius:8px;font-weight:700!important;transition:all .2s!important}
.nk-cta:hover{background:var(--a300)!important;transform:translateY(-1px)}
.nk-driver{border:1px solid rgba(255,255,255,.12)!important;padding:9px 20px!important;border-radius:8px;color:var(--e300)!important}
.nk-driver:hover{border-color:var(--a400)!important;color:var(--w)!important}
.nm{display:none;background:none;border:none;cursor:pointer;padding:8px}
.nm span{display:block;width:20px;height:2px;background:var(--w);margin:4px 0;border-radius:1px}
@media(max-width:900px){.nk{display:none}.nm{display:block}}

/* ===== HERO ===== */
.hero{position:relative;min-height:100vh;display:flex;align-items:center;background:var(--e950);overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:
  radial-gradient(ellipse 60% 40% at 70% 25%,rgba(201,139,10,.12),transparent 50%),
  radial-gradient(ellipse 50% 50% at 20% 80%,rgba(83,73,62,.15),transparent 45%),
  radial-gradient(ellipse 40% 35% at 50% 50%,rgba(201,139,10,.04),transparent 40%)}
.hero-g{position:absolute;inset:0;opacity:.03;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
/* Topographic contour lines — visible */
.hero-topo{position:absolute;inset:0;opacity:.08;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='900' viewBox='0 0 900 900'%3E%3Cg fill='none' stroke='%23e4a41d' stroke-width='0.7'%3E%3Cellipse cx='450' cy='450' rx='400' ry='200'/%3E%3Cellipse cx='450' cy='450' rx='340' ry='170'/%3E%3Cellipse cx='450' cy='450' rx='280' ry='140'/%3E%3Cellipse cx='450' cy='450' rx='220' ry='110'/%3E%3Cellipse cx='450' cy='450' rx='160' ry='80'/%3E%3Cellipse cx='450' cy='450' rx='100' ry='50'/%3E%3Cellipse cx='450' cy='450' rx='45' ry='22'/%3E%3Cellipse cx='280' cy='320' rx='200' ry='130' transform='rotate(-12 280 320)'/%3E%3Cellipse cx='280' cy='320' rx='140' ry='95' transform='rotate(-12 280 320)'/%3E%3Cellipse cx='280' cy='320' rx='80' ry='55' transform='rotate(-12 280 320)'/%3E%3Cellipse cx='280' cy='320' rx='30' ry='18' transform='rotate(-12 280 320)'/%3E%3Cellipse cx='640' cy='560' rx='180' ry='110' transform='rotate(18 640 560)'/%3E%3Cellipse cx='640' cy='560' rx='120' ry='75' transform='rotate(18 640 560)'/%3E%3Cellipse cx='640' cy='560' rx='60' ry='38' transform='rotate(18 640 560)'/%3E%3C/g%3E%3C/svg%3E");background-size:120% 120%;background-position:center;animation:topo-shift 40s ease-in-out infinite alternate}
@keyframes topo-shift{0%{background-position:0% 0%;transform:scale(1) rotate(0deg)}100%{background-position:5% 3%;transform:scale(1.05) rotate(.8deg)}}
/* Floating gradient orbs — visible */
.hero-orbs{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.hero-orb{position:absolute;border-radius:50%;will-change:transform}
.hero-orb-1{width:600px;height:600px;background:rgba(201,139,10,.1);top:-15%;right:-10%;filter:blur(120px);animation:orb1 22s ease-in-out infinite alternate}
.hero-orb-2{width:500px;height:500px;background:rgba(83,73,62,.14);bottom:-20%;left:-10%;filter:blur(100px);animation:orb2 26s ease-in-out infinite alternate}
.hero-orb-3{width:400px;height:400px;background:rgba(201,139,10,.07);top:30%;left:20%;filter:blur(140px);animation:orb3 30s ease-in-out infinite alternate}
@keyframes orb1{0%{transform:translate(0,0)}50%{transform:translate(-40px,30px)}100%{transform:translate(20px,-25px)}}
@keyframes orb2{0%{transform:translate(0,0)}50%{transform:translate(30px,-20px)}100%{transform:translate(-25px,35px)}}
@keyframes orb3{0%{transform:translate(0,0)}50%{transform:translate(-20px,-25px)}100%{transform:translate(25px,15px)}}
/* Headline ambient glow */
.hero-glow{position:absolute;width:500px;height:300px;top:20%;left:5%;background:radial-gradient(ellipse,rgba(201,139,10,.08),transparent 70%);filter:blur(60px);pointer-events:none;animation:glow-pulse 8s ease-in-out infinite alternate}
@keyframes glow-pulse{0%{opacity:.7;transform:scale(1)}100%{opacity:1;transform:scale(1.1)}}
/* Dark section shared topo */
.dark-topo{position:absolute;inset:0;opacity:.05;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400' viewBox='0 0 600 400'%3E%3Cg fill='none' stroke='%23e4a41d' stroke-width='0.5'%3E%3Cellipse cx='300' cy='200' rx='260' ry='140'/%3E%3Cellipse cx='300' cy='200' rx='210' ry='110'/%3E%3Cellipse cx='300' cy='200' rx='160' ry='80'/%3E%3Cellipse cx='300' cy='200' rx='110' ry='55'/%3E%3Cellipse cx='300' cy='200' rx='60' ry='28'/%3E%3Cellipse cx='180' cy='160' rx='120' ry='75' transform='rotate(-8 180 160)'/%3E%3Cellipse cx='180' cy='160' rx='70' ry='42' transform='rotate(-8 180 160)'/%3E%3Cellipse cx='430' cy='260' rx='100' ry='60' transform='rotate(12 430 260)'/%3E%3Cellipse cx='430' cy='260' rx='50' ry='30' transform='rotate(12 430 260)'/%3E%3C/g%3E%3C/svg%3E");background-size:100% 100%}
.hc{position:relative;z-index:2;max-width:1180px;margin:0 auto;padding:130px 24px 80px;display:grid;grid-template-columns:1fr 420px;gap:64px;align-items:center}
.hc h1{font-family:var(--fd);font-size:clamp(32px,4.2vw,52px);line-height:1.08;color:var(--w);margin-bottom:20px;letter-spacing:-.5px}
.hc h1 em{font-style:italic;color:var(--a400)}
.h-sub{font-size:17px;color:var(--e400);max-width:480px;line-height:1.75;margin-bottom:28px}
/* Authority bar */
.auth-bar{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:36px}
.ab-item{display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;transition:border-color .3s}
.ab-item:hover{border-color:rgba(201,139,10,.3)}
.ab-icon{width:36px;height:36px;border-radius:9px;background:rgba(201,139,10,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.ab-icon svg{width:18px;height:18px;stroke:var(--a400);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ab-text{font-size:13px;font-weight:600;color:var(--e300);line-height:1.3}
.ab-text span{display:block;font-size:11px;font-weight:400;color:var(--e500)}
/* Hero stats */
.hst{display:flex;gap:40px;padding-top:28px;border-top:1px solid rgba(255,255,255,.06)}
.hst-v{font-family:var(--fm);font-size:28px;font-weight:700;color:var(--a400);line-height:1}
.hst-l{font-size:11px;color:var(--e500);margin-top:5px;text-transform:uppercase;letter-spacing:1.2px}

/* Hero card */
.hcard{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:32px 26px;position:relative;backdrop-filter:blur(40px);box-shadow:0 0 80px rgba(201,139,10,.06),0 0 40px rgba(0,0,0,.3)}
.hcard::before{content:'';position:absolute;top:-1px;left:24px;right:24px;height:2px;background:linear-gradient(90deg,transparent,var(--a400),transparent)}
.hcard::after{content:'';position:absolute;inset:-1px;border-radius:20px;padding:1px;background:linear-gradient(180deg,rgba(201,139,10,.2),rgba(255,255,255,.03),rgba(201,139,10,.1));-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.hcard-live{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:100px;margin-bottom:18px;background:rgba(72,168,76,.08);border:1px solid rgba(72,168,76,.18);font-size:10px;font-weight:700;color:var(--g400);text-transform:uppercase;letter-spacing:1.2px}
.hcard-live::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--g500);animation:bk 2s infinite}
@keyframes bk{0%,100%{opacity:1}50%{opacity:.25}}
.hcard-t{font-family:var(--fd);font-size:22px;color:var(--w);margin-bottom:5px}
.hcard-d{font-size:13px;color:var(--e500);margin-bottom:22px;line-height:1.5}
.hcard-in{width:100%;padding:15px 16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-family:var(--fm);font-size:16px;color:var(--w);outline:none;margin-bottom:10px;transition:border-color .3s,box-shadow .3s}
.hcard-in::placeholder{color:var(--e600)}
.hcard-in:focus{border-color:var(--a400);box-shadow:0 0 0 3px rgba(201,139,10,.1)}
.hcard-btn{width:100%;padding:15px;background:var(--a400);color:var(--e950);border:none;border-radius:10px;font-family:var(--fb);font-size:14px;font-weight:700;cursor:pointer;transition:all .2s}
.hcard-btn:hover{background:var(--a300);transform:translateY(-1px);box-shadow:0 6px 20px rgba(201,139,10,.22)}
.hcard-f{font-size:10px;color:var(--e600);text-align:center;margin-top:12px;line-height:1.5}
.hcard-f a{color:var(--e500)}

/* ===== TICKER ===== */
.tk{background:var(--e900);border-top:1px solid rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.03);padding:11px 0;overflow:hidden}
.tk-t{display:flex;gap:48px;animation:tks 38s linear infinite;width:max-content}
@keyframes tks{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
.tk-i{display:flex;align-items:center;gap:7px;white-space:nowrap;font-size:11px;color:var(--e400);font-family:var(--fm)}
.td{width:5px;height:5px;border-radius:50%;background:var(--g500);flex-shrink:0}
.td.a{background:var(--a400)}

/* ===== MOCK CONVERSATION ===== */
.convo{background:var(--w);padding:80px 24px;border-bottom:1px solid var(--e200)}
.convo-in{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:1fr 380px;gap:56px;align-items:center}
.convo-stat{padding:20px 24px;background:var(--e50);border:1px solid var(--e200);border-radius:14px;display:inline-block}
.cp-phone{background:var(--e950);border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.18)}
.cp-header{display:flex;align-items:center;gap:10px;padding:16px 20px;background:var(--e900);border-bottom:1px solid rgba(255,255,255,.06)}
.cp-dot{width:10px;height:10px;border-radius:50%;background:var(--g500);flex-shrink:0}
.cp-body{padding:16px 14px 20px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.5;position:relative}
.msg-out{align-self:flex-end;background:var(--a500);color:var(--w);border-bottom-right-radius:4px}
.msg-in{align-self:flex-start;background:var(--e850);color:var(--e200);border-bottom-left-radius:4px}
.msg-name{display:block;font-size:10px;font-weight:700;color:var(--a400);margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px}
.msg-time{text-align:center;font-family:var(--fm);font-size:10px;color:var(--g400);margin-top:6px;font-weight:600;padding:4px 12px;background:rgba(72,168,76,.08);border-radius:100px;align-self:center}

/* ===== PERSONA SECTION ===== */
.persona{background:var(--e50);padding:80px 24px}
.persona-in{max-width:1180px;margin:0 auto}
.persona-g{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:48px}
.persona-card{padding:32px 24px;background:var(--w);border:1px solid var(--e200);border-radius:16px;transition:all .3s}
.persona-card:hover{transform:translateY(-2px);box-shadow:0 12px 40px rgba(17,16,16,.06);border-color:var(--a400)}
.persona-card h4{font-family:var(--fd);font-size:20px;color:var(--e950);margin-bottom:6px}
.persona-pain{font-size:13px;color:var(--r500);font-weight:600;margin-bottom:12px;font-style:italic}
.persona-card p{font-size:13px;color:var(--e600);line-height:1.7}

/* ===== TRUST / AUTHORITY SECTION ===== */
.trust{background:var(--w);border-bottom:1px solid var(--e200);padding:80px 24px}
.trust-inner{max-width:1180px;margin:0 auto}
.trust-header{text-align:center;margin-bottom:56px}
.trust-header .s-tag{margin-bottom:12px}
.trust-header h2{font-family:var(--fd);font-size:clamp(28px,3.5vw,42px);color:var(--e950);line-height:1.12;margin-bottom:12px}
.trust-header p{font-size:15px;color:var(--e600);max-width:560px;margin:0 auto;line-height:1.7}
.trust-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.trust-card{padding:32px 24px;border:1px solid var(--e200);border-radius:16px;transition:all .3s;position:relative;overflow:hidden}
.trust-card:hover{border-color:var(--a400);transform:translateY(-2px);box-shadow:0 12px 40px rgba(17,16,16,.06)}
.tc-icon{width:48px;height:48px;background:var(--e100);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:18px;transition:background .3s}
.trust-card:hover .tc-icon{background:var(--a100)}
.tc-icon svg{width:24px;height:24px;stroke:var(--e700);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.trust-card:hover .tc-icon svg{stroke:var(--a600)}
.trust-card h4{font-family:var(--fd);font-size:18px;margin-bottom:8px;color:var(--e950)}
.trust-card p{font-size:13px;color:var(--e600);line-height:1.7}

/* ===== EXPERIENCE STRIP ===== */
.exp-strip{background:var(--e950);padding:64px 24px;overflow:hidden;position:relative}
.exp-strip::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 40% 50% at 50% 0%,rgba(201,139,10,.04),transparent)}
.exp-inner{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:32px;text-align:center}
.exp-item .exp-num{font-family:var(--fm);font-size:36px;font-weight:700;color:var(--w);line-height:1;margin-bottom:6px}
.exp-item .exp-lbl{font-size:12px;color:var(--e500);text-transform:uppercase;letter-spacing:1px;line-height:1.4}

/* ===== SECTION COMMON ===== */
section{padding:100px 24px}
.s-tag{font-family:var(--fm);font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--a500);margin-bottom:12px;font-weight:500}
.s-title{font-family:var(--fd);font-size:clamp(28px,3.5vw,44px);color:var(--e950);line-height:1.12;max-width:620px;margin-bottom:14px}
.s-desc{font-size:15px;color:var(--e600);max-width:500px;line-height:1.7}

/* ===== SERVICES ===== */
.services{background:var(--e50)}
.svc-g{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:48px}
.svc{background:var(--w);border:1px solid var(--e200);border-radius:16px;padding:32px 24px;position:relative;overflow:hidden;transition:all .3s}
.svc::after{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--a400);transform:scaleX(0);transition:transform .3s}
.svc:hover{border-color:var(--a400);transform:translateY(-3px);box-shadow:0 14px 44px rgba(17,16,16,.06)}
.svc:hover::after{transform:scaleX(1)}
.svc-ic{width:48px;height:48px;background:var(--e100);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:18px;transition:background .3s}
.svc:hover .svc-ic{background:var(--a100)}
.svc-ic svg{width:24px;height:24px;stroke:var(--e700);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.svc:hover .svc-ic svg{stroke:var(--a600)}
.svc h3{font-family:var(--fd);font-size:19px;margin-bottom:8px}
.svc p{font-size:13px;color:var(--e600);line-height:1.7;margin-bottom:18px}
.svc-lk{font-size:13px;font-weight:700;color:var(--a500);text-decoration:none;display:inline-flex;align-items:center;gap:5px;transition:gap .2s}
.svc-lk:hover{gap:10px}

/* ===== MEMBERSHIP ===== */
.mem{background:var(--e950);position:relative;overflow:hidden}
.mem::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 45% 35% at 50% 0%,rgba(201,139,10,.05),transparent)}
.mem-in{max-width:1180px;margin:0 auto;position:relative;z-index:1}
.mem .s-title{color:var(--w)}
.mem .s-desc{color:var(--e400)}
/* Guarantee */
.guar{display:flex;align-items:center;gap:14px;background:rgba(72,168,76,.06);border:1px solid rgba(72,168,76,.15);border-radius:14px;padding:18px 24px;margin-top:28px;margin-bottom:48px;max-width:680px}
.guar-ic{width:44px;height:44px;flex-shrink:0;background:rgba(72,168,76,.08);border-radius:11px;display:flex;align-items:center;justify-content:center}
.guar-ic svg{width:22px;height:22px;stroke:var(--g400);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.guar h4{font-size:14px;font-weight:700;color:var(--g400);margin-bottom:2px}
.guar p{font-size:12px;color:var(--e400);line-height:1.5}
/* Pricing */
.pr-g{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.pr{background:var(--e900);border:1px solid rgba(255,255,255,.05);border-radius:20px;padding:32px 24px;position:relative;transition:all .3s}
.pr:hover{border-color:rgba(255,255,255,.1);transform:translateY(-3px);box-shadow:0 16px 52px rgba(0,0,0,.25)}
.pr.ft{border-color:var(--a400);background:var(--e850)}
.pr.ft::before{content:'MOST POPULAR';position:absolute;top:-1px;left:50%;transform:translateX(-50%);padding:3px 14px;background:var(--a400);border-radius:0 0 7px 7px;font-size:9px;font-weight:700;letter-spacing:1.2px;color:var(--e950)}
/* Truck SVG for each tier */
.pr-truck{height:48px;margin-bottom:16px;display:flex;align-items:center}
.pr-truck svg{height:40px;width:auto;fill:none;stroke:var(--e500);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.pr.ft .pr-truck svg{stroke:var(--a400)}
.pr-name{font-family:var(--fd);font-size:24px;color:var(--w);margin-bottom:3px}
.pr-who{font-size:12px;color:var(--e500);margin-bottom:18px;line-height:1.5}
.pr-price{display:flex;align-items:baseline;gap:3px;margin-bottom:3px}
.pr-dollar{font-family:var(--fm);font-size:38px;font-weight:700;color:var(--w);line-height:1}
.pr-per{font-size:13px;color:var(--e500)}
.pr-save{font-size:11px;color:var(--g400);margin-bottom:20px;font-weight:600}
.pr-div{height:1px;background:rgba(255,255,255,.05);margin-bottom:20px}
.pr-ft{list-style:none;margin-bottom:24px}
.pr-ft li{font-size:13px;color:var(--e300);padding:5px 0 5px 22px;position:relative;line-height:1.5}
.pr-ft li::before{content:'✓';position:absolute;left:0;color:var(--g400);font-weight:700;font-size:12px}
.pr-ft li.hl{color:var(--a300);font-weight:600}
.pr-btn{width:100%;padding:13px;border-radius:10px;font-family:var(--fb);font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;text-decoration:none;display:block;text-align:center}
.pr-btn-a{background:var(--a400);color:var(--e950);border:none}
.pr-btn-a:hover{background:var(--a300);transform:translateY(-1px)}
.pr-btn-o{background:transparent;color:var(--e300);border:1px solid rgba(255,255,255,.1)}
.pr-btn-o:hover{border-color:var(--a400);color:var(--w)}
/* Free trial */
.free-trial{text-align:center;margin-top:44px;padding-top:36px;border-top:1px solid rgba(255,255,255,.05)}
.free-trial h4{font-family:var(--fd);font-size:20px;color:var(--w);margin-bottom:6px}
.free-trial p{font-size:13px;color:var(--e500);max-width:440px;margin:0 auto 16px;line-height:1.6}
.free-trial a{font-size:13px;font-weight:700;color:var(--a400);text-decoration:none;display:inline-flex;align-items:center;gap:5px;transition:gap .2s}
.free-trial a:hover{gap:10px}

/* ===== HOW IT WORKS ===== */
.how{background:var(--e100)}
.how-in{max-width:1180px;margin:0 auto}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;margin-top:48px;background:var(--e200);border-radius:16px;overflow:hidden}
.stp{padding:36px 24px;background:var(--w);transition:background .3s}
.stp:hover{background:var(--e50)}
.stp-n{font-family:var(--fm);font-size:40px;font-weight:700;color:var(--e150);line-height:1;margin-bottom:18px}
.stp h4{font-family:var(--fd);font-size:17px;margin-bottom:8px}
.stp p{font-size:12px;color:var(--e600);line-height:1.7}
.stp-t{display:inline-block;margin-top:12px;font-family:var(--fm);font-size:10px;color:var(--a600);padding:3px 10px;background:var(--a100);border-radius:100px;font-weight:500}

/* ===== TESTIMONIALS ===== */
.proof{background:var(--w);border-top:1px solid var(--e200)}
.proof-in{max-width:1180px;margin:0 auto}
.tg{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin-top:48px}
.tst{background:var(--e50);border:1px solid var(--e200);border-radius:16px;padding:28px;transition:transform .3s}
.tst:hover{transform:translateY(-2px)}
.tst-s{color:var(--a400);font-size:13px;margin-bottom:12px;letter-spacing:1px}
.tst q{display:block;font-size:14px;color:var(--e800);line-height:1.7;font-style:italic;margin-bottom:16px}
.tst-w{display:flex;align-items:center;gap:10px}
.tst-av{width:34px;height:34px;border-radius:8px;background:var(--e800);display:flex;align-items:center;justify-content:center;color:var(--a400);font-family:var(--fm);font-size:11px;font-weight:700}
.tst-nm{font-size:13px;font-weight:700;color:var(--e950)}
.tst-rl{font-size:11px;color:var(--e500)}

/* ===== COVERAGE ===== */
.cov{background:var(--e100)}
.cov-in{max-width:1180px;margin:0 auto}
.cov-g{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start;margin-top:40px}
.mtabs{display:flex;gap:6px;margin-bottom:20px}
.mt{padding:8px 18px;border-radius:100px;border:1px solid var(--e200);background:var(--w);color:var(--e700);font-family:var(--fb);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
.mt.on{background:var(--e950);color:var(--w);border-color:var(--e950)}
.cg{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.cp{display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--w);border:1px solid var(--e200);border-radius:8px;font-size:12px;color:var(--e800);font-weight:500;transition:all .2s}
.cp:hover{border-color:var(--a400);background:var(--a100)}
.cd{width:5px;height:5px;border-radius:50%;background:var(--g500);flex-shrink:0}
.cov-r{background:var(--e950);border-radius:20px;padding:40px;position:relative;overflow:hidden}
.cov-r::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(201,139,10,.04),transparent 60%)}
.cov-r-i{position:relative;z-index:1}
.cov-r h3{font-family:var(--fd);font-size:24px;color:var(--w);margin-bottom:10px}
.cov-r p{font-size:13px;color:var(--e400);line-height:1.7;margin-bottom:24px}
.ep{display:flex;gap:8px;flex-wrap:wrap}
.ep span{padding:6px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:100px;font-size:11px;color:var(--e300);font-weight:500}

/* ===== SAVINGS CALCULATOR ===== */
.calc{background:var(--e950);position:relative;overflow:hidden;padding:80px 24px}
.calc::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 40% 50% at 25% 50%,rgba(201,139,10,.05),transparent)}
.calc-in{max-width:1180px;margin:0 auto;position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.calc .s-title{color:var(--w)}
.calc .s-desc{color:var(--e400)}
.calc-form{background:var(--e900);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:36px 28px}
.cf-label{font-size:11px;font-weight:600;color:var(--e400);margin-bottom:6px;display:block;text-transform:uppercase;letter-spacing:.8px}
.cf-row{margin-bottom:18px}
.cf-input{width:100%;padding:14px 16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-family:var(--fm);font-size:18px;color:var(--w);outline:none;transition:border-color .3s}
.cf-input:focus{border-color:var(--a400)}
.cf-input::placeholder{color:var(--e600)}
.cf-hint{font-size:10px;color:var(--e600);margin-top:4px}
.cf-btn{width:100%;padding:14px;background:var(--a400);color:var(--e950);border:none;border-radius:10px;font-family:var(--fb);font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;margin-top:4px}
.cf-btn:hover{background:var(--a300)}
.calc-result{margin-top:16px;padding:24px;background:rgba(72,168,76,.06);border:1px solid rgba(72,168,76,.15);border-radius:14px;display:none}
.calc-result.show{display:block}
.cr-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0}
.cr-row:not(:last-child){border-bottom:1px solid rgba(255,255,255,.04)}
.cr-label{font-size:12px;color:var(--e400)}
.cr-val{font-family:var(--fm);font-size:15px;font-weight:700;color:var(--w)}
.cr-val.red{color:var(--r500)}
.cr-val.green{color:var(--g400)}
.cr-savings{text-align:center;padding:16px 0 4px;margin-top:8px;border-top:1px solid rgba(72,168,76,.15)}
.cr-savings-num{font-family:var(--fm);font-size:32px;font-weight:700;color:var(--g400);line-height:1}
.cr-savings-lbl{font-size:12px;color:var(--g400);margin-top:4px;font-weight:600}

/* ===== COMPARISON TABLE ===== */
.compare{background:var(--w);padding:80px 24px;border-top:1px solid var(--e200);border-bottom:1px solid var(--e200)}
.cmp-in{max-width:880px;margin:0 auto}
.cmp-table{width:100%;border-collapse:collapse;margin-top:40px}
.cmp-table thead th{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--e500);font-weight:600;padding:12px 14px 18px;text-align:center;border-bottom:2px solid var(--e200)}
.cmp-table thead th:first-child{text-align:left}
.cmp-table thead th.hl{color:var(--a600);border-bottom-color:var(--a400)}
.cmp-table td{padding:14px;text-align:center;font-size:13px;color:var(--e700);border-bottom:1px solid var(--e150)}
.cmp-table td:first-child{text-align:left;font-weight:600;color:var(--e800);font-size:14px}
.cmp-table td.hl{background:rgba(254,245,222,.5);font-weight:700;color:var(--e950)}
.cmp-table tr:last-child td{border-bottom:none}
.ck{color:var(--g500);font-weight:700;font-size:16px}
.cx{color:var(--e300);font-size:16px}
.cmp-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}

/* ===== FAQ ===== */
.faq{background:var(--e50);padding:80px 24px}
.faq-in{max-width:720px;margin:0 auto}
.faq-list{margin-top:36px}
.faq-item{border-bottom:1px solid var(--e200)}
.faq-q{width:100%;padding:18px 0;background:none;border:none;font-family:var(--fb);font-size:15px;font-weight:600;color:var(--e950);text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:16px;transition:color .2s}
.faq-q:hover{color:var(--a600)}
.faq-q::after{content:'+';font-family:var(--fm);font-size:18px;color:var(--e400);flex-shrink:0;transition:transform .3s,color .3s}
.faq-item.open .faq-q::after{transform:rotate(45deg);color:var(--a500)}
.faq-a{max-height:0;overflow:hidden;transition:max-height .35s ease}
.faq-item.open .faq-a{max-height:200px}
.faq-a p{font-size:13px;color:var(--e600);line-height:1.7;padding-bottom:18px}

/* ===== STICKY MOBILE CTA ===== */
.sticky-m{display:none;position:fixed;bottom:0;left:0;right:0;z-index:99;padding:12px 16px;background:rgba(17,16,16,.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.06);transform:translateY(100%);transition:transform .4s ease}
.sticky-m.show{transform:translateY(0)}
.sticky-m-inner{display:flex;gap:10px;max-width:500px;margin:0 auto}
.sm-btn{flex:1;padding:13px;border-radius:10px;font-family:var(--fb);font-size:13px;font-weight:700;text-align:center;text-decoration:none;cursor:pointer;transition:all .2s}
.sm-primary{background:var(--a400);color:var(--e950);border:none}
.sm-secondary{background:transparent;color:var(--e300);border:1px solid rgba(255,255,255,.12)}
/* ===== QUICK-FILL ===== */
.qf{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap}
.qf-btn{padding:7px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;font-family:var(--fm);font-size:11px;color:var(--e400);cursor:pointer;transition:all .2s}
.qf-btn:hover{border-color:var(--a400);color:var(--a400)}
.qf-btn.on{background:rgba(228,164,29,.12);border-color:var(--a400);color:var(--a400)}

@media(max-width:900px){.sticky-m{display:block}.calc-in{grid-template-columns:1fr}.cmp-table{font-size:12px}.cmp-table td,.cmp-table th{padding:10px 8px}.convo-in{grid-template-columns:1fr}.persona-g{grid-template-columns:1fr}}

/* ===== FINAL CTA ===== */
.fcta{background:var(--e950);padding:90px 24px;text-align:center;position:relative;overflow:hidden}
.fcta::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 50% 40% at 50% 100%,rgba(201,139,10,.07),transparent)}
.fc-in{max-width:580px;margin:0 auto;position:relative;z-index:1}
.fcta h2{font-family:var(--fd);font-size:clamp(28px,3.5vw,42px);color:var(--w);line-height:1.15;margin-bottom:12px}
.fcta .fc-in>p{font-size:15px;color:var(--e400);margin-bottom:32px;line-height:1.7}
.fc-ph{display:inline-flex;align-items:center;gap:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);padding:16px 32px;border-radius:14px;margin-bottom:12px;transition:border-color .3s}
.fc-ph:hover{border-color:var(--a400)}
.fc-n{font-family:var(--fm);font-size:24px;font-weight:700;color:var(--w);text-decoration:none;letter-spacing:.5px}
.fc-or{font-size:12px;color:var(--e600);margin:14px 0}
.fc-btn{display:inline-flex;align-items:center;gap:7px;padding:14px 32px;background:var(--a400);color:var(--e950);border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;transition:all .2s}
.fc-btn:hover{background:var(--a300);transform:translateY(-1px);box-shadow:0 6px 24px rgba(201,139,10,.22)}

/* ===== FOOTER ===== */
footer{background:var(--e950);border-top:1px solid rgba(255,255,255,.04);padding:48px 24px 32px}
.ft-in{max-width:1180px;margin:0 auto;display:flex;justify-content:space-between;align-items:flex-start}
.ft-b{font-family:var(--fm);font-size:14px;color:var(--w);font-weight:700;margin-bottom:5px}
.ft-b i{font-style:normal;color:var(--a400)}
.ft-tg{font-size:11px;color:var(--e600);max-width:240px;line-height:1.5}
.ft-cs{display:flex;gap:32px}
.ft-c h5{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--e500);margin-bottom:12px}
.ft-c a{display:block;font-size:12px;color:var(--e400);text-decoration:none;margin-bottom:7px;transition:color .2s}
.ft-c a:hover{color:var(--w)}
.ft-bt{max-width:1180px;margin:36px auto 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.04);display:flex;justify-content:space-between;font-size:10px;color:var(--e600)}

/* ===== ANIMATIONS ===== */
.fu{opacity:0;transform:translateY(22px);transition:opacity .6s,transform .6s}
.fu.v{opacity:1;transform:translateY(0)}

/* ===== RESPONSIVE ===== */
@media(max-width:900px){
  .hc{grid-template-columns:1fr;gap:28px;padding-top:52px;padding-bottom:40px}
  .hero{min-height:0;display:block}
  .hero-orb-1{width:400px;height:400px;background:rgba(201,139,10,.14);top:-5%;right:-15%;filter:blur(80px)}
  .hero-orb-2{width:350px;height:350px;background:rgba(83,73,62,.18);bottom:-10%;left:-15%;filter:blur(70px)}
  .hero-orb-3{width:280px;height:280px;background:rgba(201,139,10,.1);top:25%;left:10%;filter:blur(90px)}
  .hero-topo{opacity:.1}
  .hero-glow{width:350px;height:200px;top:10%;left:-5%;opacity:1;filter:blur(40px)}
  .hc h1{font-size:clamp(28px,8vw,42px)}
  .h-sub{font-size:15px;margin-bottom:20px}
  .auth-bar{gap:8px}
  .ab-item{padding:8px 12px;flex:1;min-width:140px}
  .ab-text{font-size:12px}
  .ab-text span{font-size:10px}
  .hst{gap:24px;flex-direction:row}
  .hst-v{font-size:24px}
  .hcard{padding:28px 22px;box-shadow:0 0 60px rgba(201,139,10,.08),0 0 30px rgba(0,0,0,.4)}
  .trust-grid,.svc-g,.pr-g{grid-template-columns:1fr}
  .steps{grid-template-columns:1fr 1fr}
  .exp-inner{grid-template-columns:1fr 1fr}
  .tg{grid-template-columns:1fr}
  .cov-g{grid-template-columns:1fr}
  .ft-in{flex-direction:column;gap:24px}
  .ft-cs{flex-wrap:wrap;gap:16px}
  .ft-bt{flex-direction:column;gap:4px}
}
@media(max-width:600px){
  .hc{padding-top:48px;gap:18px}
  .hc h1{font-size:clamp(26px,7.5vw,36px);margin-bottom:14px}
  .h-sub{font-size:14px;line-height:1.65;margin-bottom:16px}
  .hero-orb-1{background:rgba(201,139,10,.18);filter:blur(60px)}
  .hero-orb-2{background:rgba(83,73,62,.2);filter:blur(50px)}
  .hero-orb-3{background:rgba(201,139,10,.12);filter:blur(70px)}
  .hero-topo{opacity:.12}
  .hero-glow{width:300px;height:180px}
  .auth-bar{flex-direction:column;gap:6px}
  .ab-item{min-width:auto}
  .hst{flex-direction:row;gap:16px;padding-top:20px}
  .hst-v{font-size:22px}
  .hst-l{font-size:9px}
  .hcard{padding:24px 18px}
  .hcard-t{font-size:20px}
  .steps{grid-template-columns:1fr}
  .exp-inner{grid-template-columns:1fr 1fr}
  .cg{grid-template-columns:1fr}
  .fc-ph{padding:12px 18px}
  .fc-n{font-size:19px}
}
`

export default function HomePage() {
  const [scrolled, setScrolled] = useState(false)
  const [sticky, setSticky] = useState(false)
  const [phone, setPhone] = useState('')
  const [market, setMarket] = useState('dfw')
  const [faq, setFaq] = useState<number | null>(null)
  const [activeQf, setActiveQf] = useState<number | null>(null)
  const [calcHrs, setCalcHrs] = useState('')
  const [calcRate, setCalcRate] = useState('')
  const [calcResult, setCalcResult] = useState<{
    weekly: string; annual: string; saved: string; weeks: string
  } | null>(null)

  // Scroll listener for nav + sticky CTA
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 40)
      setSticky(window.scrollY > 600)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Intersection observer for fade-up animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('v')
        })
      },
      { threshold: 0.07, rootMargin: '0px 0px -25px 0px' }
    )
    document.querySelectorAll('.fu').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Phone formatter
  const handlePhone = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/\D/g, '')
    if (v.length > 10) v = v.slice(0, 10)
    if (v.length >= 6) v = `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`
    else if (v.length >= 3) v = `(${v.slice(0,3)}) ${v.slice(3)}`
    setPhone(v)
  }, [])

  // SMS handler
  const handleSms = useCallback(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length === 10) {
      window.location.href = 'sms:+14697174225?body=Hey, I need a dump site.'
    }
  }, [phone])

  // Calculator
  const handleCalc = useCallback(() => {
    const hrs = parseInt(calcHrs) || 0
    const rate = parseInt(calcRate) || 0
    if (hrs > 0 && rate > 0) {
      const weekCost = hrs * rate
      const annual = weekCost * 52
      const totalHrs = hrs * 52
      const weeks = Math.round(totalHrs / 40)
      setCalcResult({
        weekly: `${hrs} hrs/wk × $${rate}/hr = $${weekCost.toLocaleString()}/wk`,
        annual: `$${annual.toLocaleString()}/yr`,
        saved: `$${annual.toLocaleString()}`,
        weeks: `That's ${totalHrs.toLocaleString()} hours — ${weeks} full work weeks you get back.`,
      })
    }
  }, [calcHrs, calcRate])

  // Quick-fill handler
  const handleQf = useCallback((hrs: number, rate: number, idx: number) => {
    setCalcHrs(String(hrs))
    setCalcRate(String(rate))
    setActiveQf(idx)
    // Trigger calc after state update
    const weekCost = hrs * rate
    const annual = weekCost * 52
    const totalHrs = hrs * 52
    const weeks = Math.round(totalHrs / 40)
    setCalcResult({
      weekly: `${hrs} hrs/wk × $${rate}/hr = $${weekCost.toLocaleString()}/wk`,
      annual: `$${annual.toLocaleString()}/yr`,
      saved: `$${annual.toLocaleString()}`,
      weeks: `That's ${totalHrs.toLocaleString()} hours — ${weeks} full work weeks you get back.`,
    })
  }, [])

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=DM+Serif+Display:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      {/* NAV */}
<nav className={`nav ${scrolled ? "s" : ""}`} id="nav">
<div className="ni">
  <a href="/" className="nl">DUMP<i>SITE</i>.IO</a>
  <ul className="nk">
    <li><a href="#services">Services</a></li>
    <li><a href="#membership">Plans</a></li>
    <li><a href="#how">How It Works</a></li>
    <li><a href="#proof">Results</a></li>
    <li><a href="/drivers" className="nk-driver">I'm a Driver</a></li>
    <li><a href="#membership" className="nk-cta">See Plans</a></li>
  </ul>
  <button className="nm" aria-label="Menu"><span></span><span></span><span></span></button>
</div>
</nav>

{/* HERO */}
<section className="hero">
<div className="hero-g"></div>
<div className="hero-topo"></div>
<div className="hero-orbs">
  <div className="hero-orb hero-orb-1"></div>
  <div className="hero-orb hero-orb-2"></div>
  <div className="hero-orb hero-orb-3"></div>
</div>
<div className="hero-glow"></div>
<div className="hc">
  <div>
    <h1>Burning time<br />finding dump sites.<br />Burning money<br />at the landfill.<br /><em>We fix that.</em></h1>
    <p className="h-sub">DumpSite gives contractors, excavators, and developers their own dedicated dirt dispatcher — with access to free and low-cost dump sites across Texas and Colorado. Stop calling around. Stop overpaying. Stop losing sleep.</p>

    <div className="auth-bar">
      <div className="ab-item">
        <div className="ab-icon"><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
        <div className="ab-text">10+ Years<span>Moving dirt in Texas</span></div>
      </div>
      <div className="ab-item">
        <div className="ab-icon"><svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
        <div className="ab-text">Highway &amp; Utility<span>24-hour operations</span></div>
      </div>
      <div className="ab-item">
        <div className="ab-icon"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <div className="ab-text">200+ Trucks<span>Verified driver network</span></div>
      </div>
    </div>

    <div className="hst">
      <div><div className="hst-v">$0</div><div className="hst-l">Dump Fees</div></div>
      <div><div className="hst-v">2</div><div className="hst-l">Metro Markets</div></div>
      <div><div className="hst-v">&lt;1hr</div><div className="hst-l">Avg. Dispatch</div></div>
    </div>
  </div>

  <div className="hcard">
    <div className="hcard-live">Sites available now</div>
    <div className="hcard-t">Your first dump site is free</div>
    <div className="hcard-d">Tell us what you're hauling and where you're coming from. Your dispatcher will match you with the closest approved site.</div>
    <input className="hcard-in" type="tel" value={phone} onChange={handlePhone} placeholder="Your phone number" maxLength={14} autoComplete="tel" />
    <button className="hcard-btn" onClick={handleSms}>Get My Free Dump Site →</button>
    <p className="hcard-f">Your dispatcher will reach out directly. No apps, no accounts, no hassle.<br /><a href="/privacy">Privacy Policy</a></p>
  </div>
</div>
</section>

{/* TICKER */}
<div className="tk">
<div className="tk-t">
  <span className="tk-i"><span className="td"></span>3 loads dumped free — Mansfield, TX — 12 min ago</span>
  <span className="tk-i"><span className="td a"></span>Member saved $4,200 this month — Arlington, TX</span>
  <span className="tk-i"><span className="td"></span>Job completed — Aurora, CO — 28 min ago</span>
  <span className="tk-i"><span className="td"></span>5 loads dumped free — Fort Worth, TX — 45 min ago</span>
  <span className="tk-i"><span className="td a"></span>New member joined — Denver, CO — 8 min ago</span>
  <span className="tk-i"><span className="td"></span>8 loads dumped free — Dallas, TX — 1 hr ago</span>
  <span className="tk-i"><span className="td a"></span>Contractor saved $31K on project — Grand Prairie, TX</span>
  <span className="tk-i"><span className="td"></span>Driver dispatched — Lakewood, CO — now</span>
  <span className="tk-i"><span className="td"></span>3 loads dumped free — Mansfield, TX — 12 min ago</span>
  <span className="tk-i"><span className="td a"></span>Member saved $4,200 this month — Arlington, TX</span>
  <span className="tk-i"><span className="td"></span>Job completed — Aurora, CO — 28 min ago</span>
  <span className="tk-i"><span className="td"></span>5 loads dumped free — Fort Worth, TX — 45 min ago</span>
  <span className="tk-i"><span className="td a"></span>New member joined — Denver, CO — 8 min ago</span>
  <span className="tk-i"><span className="td"></span>8 loads dumped free — Dallas, TX — 1 hr ago</span>
  <span className="tk-i"><span className="td a"></span>Contractor saved $31K on project — Grand Prairie, TX</span>
  <span className="tk-i"><span className="td"></span>Driver dispatched — Lakewood, CO — now</span>
</div>
</div>

{/* MOCK CONVERSATION */}
<div className="convo">
<div className="convo-in">
  <div className="fu">
    <div className="s-tag">What you get</div>
    <h2 style={{fontFamily:'var(--fd)',fontSize:'clamp(26px,3vw,36px)',color:'var(--e950)',lineHeight:'1.15',marginBottom:'12px'}}>You reach out.<br />This is what comes back.</h2>
    <p style={{fontSize:'14px',color:'var(--e600)',lineHeight:'1.7',marginBottom:'24px',maxWidth:'380px'}}>Your dedicated dispatcher matches you with the closest free dump site in minutes. Here's a real result from last week.</p>
    <div className="convo-stat">
      <div style={{fontFamily:'var(--fm)',fontSize:'28px',fontWeight:'700',color:'var(--e950)',lineHeight:'1'}}>$847K+</div>
      <div style={{fontSize:'12px',color:'var(--e600)',marginTop:'4px'}}>saved by members last quarter</div>
    </div>
  </div>
  <div className="cp-phone fu">
    <div className="cp-header">
      <div className="cp-dot"></div>
      <div>
        <div style={{fontSize:'13px',fontWeight:'700',color:'var(--w)'}}>DumpSite Dispatch</div>
        <div style={{fontSize:'10px',color:'var(--g400)'}}>Live — just now</div>
      </div>
    </div>
    <div className="cp-body" style={{gap:'0'}}>
      <div style={{padding:'16px 0 12px'}}>
        <div style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'1.2px',color:'var(--a400)',fontWeight:'700',fontFamily:'var(--fm)',marginBottom:'14px'}}>Site matched</div>
        <div style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,.05)'}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginTop:'2px',flexShrink:'0'}}><polyline points="20 6 9 17 4 12"/></svg>
          <div><div style={{fontSize:'13px',color:'var(--w)',fontWeight:'600'}}>Free dump site — 8 min from job</div><div style={{fontSize:'11px',color:'var(--e500)',marginTop:'2px'}}>Mansfield, TX</div></div>
        </div>
        <div style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,.05)'}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginTop:'2px',flexShrink:'0'}}><polyline points="20 6 9 17 4 12"/></svg>
          <div><div style={{fontSize:'13px',color:'var(--w)',fontWeight:'600'}}>Clean fill accepted</div><div style={{fontSize:'11px',color:'var(--e500)',marginTop:'2px'}}>Clay, topsoil, foundation material</div></div>
        </div>
        <div style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,.05)'}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginTop:'2px',flexShrink:'0'}}><polyline points="20 6 9 17 4 12"/></svg>
          <div><div style={{fontSize:'13px',color:'var(--w)',fontWeight:'600'}}>Available tomorrow 7am</div><div style={{fontSize:'11px',color:'var(--e500)',marginTop:'2px'}}>Site contact notified &amp; expecting you</div></div>
        </div>
        <div style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'10px 0'}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginTop:'2px',flexShrink:'0'}}><polyline points="20 6 9 17 4 12"/></svg>
          <div><div style={{fontSize:'13px',color:'var(--w)',fontWeight:'600'}}>50 yards capacity confirmed</div><div style={{fontSize:'11px',color:'var(--e500)',marginTop:'2px'}}>No per-load fees for members</div></div>
        </div>
      </div>
      <div className="msg-time">Time to match: 3 minutes</div>
    </div>
  </div>
</div>
</div>

{/* WHO IT'S FOR */}
<div className="persona">
<div className="persona-in">
  <div style={{textAlign:'center'}}>
    <div className="s-tag fu">Who it's for</div>
    <h2 className="s-title fu" style={{margin:'0 auto',textAlign:'center'}}>If you move dirt, this is for you.</h2>
  </div>
  <div className="persona-g">
    <div className="persona-card fu">
      <h4>Excavation Companies</h4>
      <div className="persona-pain">"I spend half my morning calling around for dump sites."</div>
      <p>Your dispatcher finds the closest free site in minutes. You just show up and dump. No more calling five numbers and getting three voicemails.</p>
    </div>
    <div className="persona-card fu">
      <h4>General Contractors</h4>
      <div className="persona-pain">"Disposal costs are eating my margins alive."</div>
      <p>Members dump for free. On a subdivision project, that's $20K–50K saved. Your dispatcher handles the logistics so your crew stays on schedule.</p>
    </div>
    <div className="persona-card fu">
      <h4>Developers &amp; Small Operators</h4>
      <div className="persona-pain">"I just need somewhere to put this dirt without getting ripped off."</div>
      <p>Whether you're building a pad site or clearing a back lot, your dispatcher matches you with an approved site at zero cost. No minimums, no runaround.</p>
    </div>
  </div>
</div>
</div>

{/* TRUST / AUTHORITY */}
<div className="trust">
<div className="trust-inner">
  <div className="trust-header">
    <div className="s-tag fu">Built on experience</div>
    <h2 className="fu">This isn't our first job site.</h2>
    <p className="fu">From 24-hour highway operations to multi-year utility projects to helping a dad find somewhere to dump his trailer — we've done it all. That experience is why our network works.</p>
  </div>
  <div className="trust-grid">
    <div className="trust-card fu">
      <div className="tc-icon"><svg viewBox="0 0 24 24"><rect x="1" y="6" width="22" height="12" rx="2"/><path d="M1 10h22"/><path d="M6 18v2"/><path d="M18 18v2"/><path d="M6 4v2"/><path d="M18 4v2"/></svg></div>
      <h4>Highway Development</h4>
      <p>TxDOT and state highway projects running dump trucks 24 hours a day, 7 days a week. Millions of yards moved on deadline and spec.</p>
    </div>
    <div className="trust-card fu">
      <div className="tc-icon"><svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9h1"/><path d="M9 13h1"/><path d="M9 17h1"/></svg></div>
      <h4>Multi-Year Utility Projects</h4>
      <p>Subdivision infrastructure, water main, and sewer line projects. Coordinating material movement across months-long schedules.</p>
    </div>
    <div className="trust-card fu">
      <div className="tc-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
      <h4>Every Job, Every Scale</h4>
      <p>From a 5,000-yard commercial pad site to a retired guy clearing his back lot. We treat every load the same — fast, verified, and handled.</p>
    </div>
  </div>
</div>
</div>

{/* EXPERIENCE STATS */}
<div className="exp-strip">
<div className="dark-topo"></div>
<div className="exp-inner">
  <div className="exp-item fu"><div className="exp-num">10+</div><div className="exp-lbl">Years in<br />dirt logistics</div></div>
  <div className="exp-item fu"><div className="exp-num">200+</div><div className="exp-lbl">Verified trucks<br />in our network</div></div>
  <div className="exp-item fu"><div className="exp-num">40+</div><div className="exp-lbl">Cities with<br />active sites</div></div>
  <div className="exp-item fu"><div className="exp-num">$0</div><div className="exp-lbl">Dump fees<br />for members</div></div>
</div>
</div>

{/* COMPARISON TABLE */}
<div className="compare">
<div className="cmp-in">
  <div style={{textAlign:'center'}}>
    <div className="s-tag fu">Why switch</div>
    <h2 className="s-title fu" style={{margin:'0 auto 8px',textAlign:'center'}}>See for yourself.</h2>
    <p className="s-desc fu" style={{margin:'0 auto',textAlign:'center'}}>How DumpSite stacks up against the way you're doing it now.</p>
  </div>
  <div className="cmp-scroll">
  <table className="cmp-table fu">
    <thead>
      <tr>
        <th></th>
        <th>Calling Around</th>
        <th>Landfill</th>
        <th className="hl">DumpSite</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Find a dump site</td>
        <td>2–4 hours of calls</td>
        <td>Always available</td>
        <td className="hl">Minutes</td>
      </tr>
      <tr>
        <td>Cost per load</td>
        <td>Varies / Unknown</td>
        <td>$35–50/ton</td>
        <td className="hl">$0 for members</td>
      </tr>
      <tr>
        <td>Dedicated dispatcher</td>
        <td><span className="cx">✗</span></td>
        <td><span className="cx">✗</span></td>
        <td className="hl"><span className="ck">✓</span></td>
      </tr>
      <tr>
        <td>Guaranteed availability</td>
        <td><span className="cx">✗</span></td>
        <td><span className="cx">✗</span></td>
        <td className="hl"><span className="ck">✓</span> For members</td>
      </tr>
      <tr>
        <td>Load tracking</td>
        <td><span className="cx">✗</span></td>
        <td><span className="cx">✗</span></td>
        <td className="hl"><span className="ck">✓</span> Real-time</td>
      </tr>
      <tr>
        <td>Money-back guarantee</td>
        <td><span className="cx">✗</span></td>
        <td><span className="cx">✗</span></td>
        <td className="hl"><span className="ck">✓</span></td>
      </tr>
      <tr>
        <td>Stress at midnight</td>
        <td>High</td>
        <td>Medium</td>
        <td className="hl">Zero</td>
      </tr>
    </tbody>
  </table>
  </div>
</div>
</div>

{/* SERVICES */}
<section className="services" id="services">
<div className="mw">
  <div className="s-tag fu">What we handle</div>
  <h2 className="s-title fu">You dig it. We move it.</h2>
  <p className="s-desc fu">Your dedicated dispatcher coordinates trucks, sites, and delivery — you never have to call around again.</p>
  <div className="svc-g">
    <div className="svc fu">
      <div className="svc-ic"><svg viewBox="0 0 24 24"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg></div>
      <h3>Dirt Export</h3>
      <p>Excavating? Your dispatcher finds the closest approved dump site — most at zero cost. Trucks show up, loads are tracked, and you get full documentation. Done.</p>
      <a href="#membership" className="svc-lk">See plans →</a>
    </div>
    <div className="svc fu">
      <div className="svc-ic"><svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div>
      <h3>Dirt Import</h3>
      <p>Need fill, topsoil, sand, or structural fill? Your dispatcher sources from our quarry network and coordinates delivery. Competitive pricing, same-week turnaround.</p>
      <a href="#cta" className="svc-lk">Get a delivery quote →</a>
    </div>
    <div className="svc fu">
      <div className="svc-ic"><svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14l2 2 4-4"/></svg></div>
      <h3>Managed Hauling</h3>
      <p>Large-scale, ongoing material movement? Your dispatcher manages the entire operation — scheduling, load tracking, volume reporting, completion documentation.</p>
      <a href="#cta" className="svc-lk">Talk to us →</a>
    </div>
  </div>
</div>
</section>

{/* TIME COST CALCULATOR */}
<div className="calc" id="calculator">
<div className="dark-topo"></div>
<div className="calc-in">
  <div>
    <div className="s-tag fu">The hidden cost</div>
    <h2 className="s-title fu">How much is finding<br />dump sites actually<br />costing you?</h2>
    <p className="s-desc fu">You know what you pay at the landfill. But have you ever calculated the cost of the hours you burn calling around, coordinating logistics, and driving to sites that are out of the way? Plug in your numbers.</p>
  </div>
  <div className="calc-form fu">
    <div style={{fontSize:'12px',color:'var(--e400)',marginBottom:'14px',fontWeight:'600'}}>Quick fill — how much time do you spend?</div>
    <div className="qf">
      <button className={`qf-btn ${activeQf === 0 ? "on" : ""}`} onClick={() => handleQf(3, 125, 0)}>A few hours</button>
      <button className={`qf-btn ${activeQf === 1 ? "on" : ""}`} onClick={() => handleQf(6, 125, 1)}>Half a day</button>
      <button className={`qf-btn ${activeQf === 2 ? "on" : ""}`} onClick={() => handleQf(10, 125, 2)}>A full day+</button>
      <button className={`qf-btn ${activeQf === 3 ? "on" : ""}`} onClick={() => handleQf(20, 125, 3)}>Way too much</button>
    </div>
    <div className="cf-row">
      <label className="cf-label">Hours per week on dump site logistics</label>
      <input className="cf-input" type="number" value={calcHrs} onChange={(e) => setCalcHrs(e.target.value)} placeholder="e.g. 8" min={1} max={60} />
      <div className="cf-hint">Calling around, coordinating, driving out of the way, waiting in line</div>
    </div>
    <div className="cf-row">
      <label className="cf-label">What's your time worth per hour? ($)</label>
      <input className="cf-input" type="number" value={calcRate} onChange={(e) => setCalcRate(e.target.value)} placeholder="e.g. 125" min={1} max={1000} />
      <div className="cf-hint">Your billable rate, or revenue ÷ hours worked</div>
    </div>
    <button className="cf-btn" onClick={handleCalc}>Show Me the Real Cost →</button>
    <div className={`calc-result ${calcResult ? "show" : ""}`}>
      <div className="cr-row">
        <span className="cr-label">Weekly time burned</span>
        <span className="cr-val">{calcResult ? calcResult.weekly : "—"}</span>
      </div>
      <div className="cr-row">
        <span className="cr-label">Annual cost of that time</span>
        <span className="cr-val red">{calcResult ? calcResult.annual : "—"}</span>
      </div>
      <div className="cr-row">
        <span className="cr-label">With DumpSite (your dispatcher handles it)</span>
        <span className="cr-val green">0 hours/wk</span>
      </div>
      <div className="cr-savings">
        <div className="cr-savings-num">{calcResult ? calcResult.saved : "—"}</div>
        <div className="cr-savings-lbl">in time and energy you get back every year</div>
        <div style={{fontSize:'11px',color:'var(--e500)',marginTop:'8px'}}>{calcResult ? calcResult.weeks : ""}</div>
      </div>
    </div>
  </div>
</div>
</div>

{/* MEMBERSHIP */}
<section className="mem" id="membership">
<div className="dark-topo"></div>
<div className="mem-in">
  <div className="s-tag fu">Membership plans</div>
  <h2 className="s-title fu" style={{maxWidth:'680px'}}>Pick the plan that fits your operation.</h2>
  <p className="s-desc fu">Every plan includes your own dedicated dirt dispatcher, access to free dump sites, and full load tracking.</p>

  <div className="guar fu">
    <div className="guar-ic"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg></div>
    <div>
      <h4>Savings Guarantee</h4>
      <p>Save more on disposal than your membership costs — or get a full refund plus your next month free. Zero risk.</p>
    </div>
  </div>

  <div className="pr-g">
    {/* PICKUP */}
    <div className="pr fu">
      <div className="pr-truck"><svg viewBox="0 0 120 50"><rect x="2" y="16" width="48" height="22" rx="3"/><rect x="50" y="22" width="36" height="16" rx="2"/><line x1="50" y1="22" x2="50" y2="38"/><circle cx="22" cy="42" r="6"/><circle cx="72" cy="42" r="6"/><line x1="86" y1="30" x2="92" y2="30"/></svg></div>
      <div className="pr-name">Pickup</div>
      <div className="pr-who">The one-truck crew. The dad-and-son. The small excavator getting it done with what they've got.</div>
      <div className="pr-price"><span className="pr-dollar">$99</span><span className="pr-per">/mo</span></div>
      <div className="pr-save">Avg. member saves $2,000+/mo vs. landfill</div>
      <div className="pr-div"></div>
      <ul className="pr-ft">
        <li className="hl">Your own dedicated dirt dispatcher</li>
        <li>Up to 50 yards/month at free dump sites</li>
        <li>Full load tracking &amp; documentation</li>
        <li>Access to DFW &amp; Denver sites</li>
        <li>Standard response time</li>
      </ul>
      <a href="/signup/membership?plan=pickup" className="pr-btn pr-btn-o">Get Started →</a>
    </div>

    {/* TANDEM */}
    <div className="pr ft fu">
      <div className="pr-truck"><svg viewBox="0 0 120 50"><rect x="2" y="12" width="40" height="26" rx="3"/><path d="M42 14h16l10 12v12H42z"/><line x1="42" y1="14" x2="42" y2="38"/><circle cx="18" cy="42" r="6"/><circle cx="52" cy="42" r="6"/><circle cx="64" cy="42" r="6"/><rect x="70" y="30" width="18" height="4" rx="1"/></svg></div>
      <div className="pr-name">Tandem</div>
      <div className="pr-who">The working contractor. The excavation crew running 2–5 trucks every single day.</div>
      <div className="pr-price"><span className="pr-dollar">$299</span><span className="pr-per">/mo</span></div>
      <div className="pr-save">Avg. member saves $5,000–10,000+/mo</div>
      <div className="pr-div"></div>
      <ul className="pr-ft">
        <li className="hl">Your own dedicated dirt dispatcher</li>
        <li>Up to 300 yards/month at free dump sites</li>
        <li>Priority site access &amp; guaranteed availability</li>
        <li>Volume discounts on dirt delivery</li>
        <li>Monthly savings report</li>
        <li>Savings guarantee — money back + 1 month free</li>
      </ul>
      <a href="/signup/membership?plan=tandem" className="pr-btn pr-btn-a">Get Started →</a>
    </div>

    {/* FLEET */}
    <div className="pr fu">
      <div className="pr-truck"><svg viewBox="0 0 120 50"><rect x="2" y="8" width="36" height="30" rx="3"/><path d="M38 10h18l12 14v14H38z"/><line x1="38" y1="10" x2="38" y2="38"/><circle cx="14" cy="42" r="6"/><circle cx="50" cy="42" r="6"/><circle cx="62" cy="42" r="6"/><rect x="72" y="14" width="38" height="20" rx="2"/><circle cx="82" cy="42" r="6"/><circle cx="102" cy="42" r="6"/></svg></div>
      <div className="pr-name">Fleet</div>
      <div className="pr-who">The boss. The GC running 10+ trucks. The developer moving thousands of yards every month.</div>
      <div className="pr-price"><span className="pr-dollar">$599</span><span className="pr-per">/mo</span></div>
      <div className="pr-save">Members save $10,000–30,000+/mo</div>
      <div className="pr-div"></div>
      <ul className="pr-ft">
        <li className="hl">Your own dedicated dirt dispatcher</li>
        <li>Unlimited yards/month at free dump sites</li>
        <li>Guaranteed site availability — always</li>
        <li>Fleet load tracking &amp; reporting</li>
        <li>Best rates on dirt delivery &amp; trucking</li>
        <li>Savings guarantee — money back + 1 month free</li>
        <li>Priority access to all new markets</li>
      </ul>
      <a href="/signup/membership?plan=fleet" className="pr-btn pr-btn-o">Get Started →</a>
    </div>
  </div>

  <div className="free-trial fu">
    <h4>Try it before you commit.</h4>
    <p>Your first dump site is on us — no card, no commitment. See how fast your dispatcher matches you, then decide if a membership makes sense for your operation.</p>
    <a href="#cta">Get your free dump site →</a>
  </div>
</div>
</section>

{/* HOW IT WORKS */}
<section className="how" id="how">
<div className="how-in">
  <div className="s-tag fu">How it works</div>
  <h2 className="s-title fu">You reach out. We handle everything.</h2>
  <p className="s-desc fu">No apps. No portals. No learning curve. Just contact your dispatcher and your job gets done.</p>
  <div className="steps">
    <div className="stp fu">
      <div className="stp-n">01</div>
      <h4>Contact your dispatcher</h4>
      <p>Tell us your address, what material you're hauling, and how many yards. Your dedicated dispatcher responds immediately.</p>
      <span className="stp-t">~60 seconds</span>
    </div>
    <div className="stp fu">
      <div className="stp-n">02</div>
      <h4>Get matched</h4>
      <p>Your dispatcher finds the closest approved dump site or delivery source. Members get priority matching and guaranteed availability.</p>
      <span className="stp-t">~2 minutes</span>
    </div>
    <div className="stp fu">
      <div className="stp-n">03</div>
      <h4>Trucks dispatched</h4>
      <p>Accept the match and trucks roll. You get driver info, truck type, and ETA. No calling around, no chasing leads.</p>
      <span className="stp-t">~15 minutes</span>
    </div>
    <div className="stp fu">
      <div className="stp-n">04</div>
      <h4>Tracked &amp; documented</h4>
      <p>Every load is logged and tracked. You get completion reports and full documentation for your records. Pay per load — clean and simple.</p>
      <span className="stp-t">Same day</span>
    </div>
  </div>
</div>
</section>

{/* PROOF */}
<section className="proof" id="proof">
<div className="proof-in">
  <div className="s-tag fu">What people are saying</div>
  <h2 className="s-title fu">We don't do testimonials. These are real jobs.</h2>
  <div className="tg">
    <div className="tst fu">
      <div className="tst-s">★★★★★</div>
      <q>Called at 7am about removing 200 yards of clay. Had three trucks on site by 9:30. No app, no paperwork, no BS. These guys actually get the dirt business.</q>
      <div className="tst-w"><div className="tst-av">MR</div><div><div className="tst-nm">Mike R.</div><div className="tst-rl">Excavation Contractor — Fort Worth, TX</div></div></div>
    </div>
    <div className="tst fu">
      <div className="tst-s">★★★★★</div>
      <q>We were paying $45 per load at the landfill. DumpSite found us approved sites where we dump for free. Saved us over $30K on a single subdivision project.</q>
      <div className="tst-w"><div className="tst-av">DP</div><div><div className="tst-nm">David P.</div><div className="tst-rl">General Contractor — Arlington, TX</div></div></div>
    </div>
    <div className="tst fu">
      <div className="tst-s">★★★★★</div>
      <q>Needed 500 yards of structural fill for a pad site. They quoted me, coordinated every delivery, and documented every single load. My project manager was blown away.</q>
      <div className="tst-w"><div className="tst-av">SL</div><div><div className="tst-nm">Sarah L.</div><div className="tst-rl">Developer — Dallas, TX</div></div></div>
    </div>
    <div className="tst fu">
      <div className="tst-s">★★★★★</div>
      <q>We run grading jobs all over the Front Range. One call and they had trucks pulling export off our Aurora site the next morning. Completely changed how we schedule removal.</q>
      <div className="tst-w"><div className="tst-av">JT</div><div><div className="tst-nm">Jason T.</div><div className="tst-rl">Grading Contractor — Denver, CO</div></div></div>
    </div>
  </div>
</div>
</section>

{/* COVERAGE */}
<section className="cov" id="coverage">
<div className="cov-in">
  <div className="s-tag fu">Coverage</div>
  <h2 className="s-title fu">Two metros. Expanding fast.</h2>
  <p className="s-desc fu">Live dump sites across DFW and Denver metro. Houston, Austin, and San Antonio coming 2026.</p>
  <div className="cov-g">
    <div>
      <div className="mtabs fu">
        <button className={`mt ${market === "dfw" ? "on" : ""}`} onClick={() => setMarket("dfw")}>Dallas–Fort Worth</button>
        <button className={`mt ${market === "den" ? "on" : ""}`} onClick={() => setMarket("den")}>Denver Metro</button>
      </div>
      <div id="m-dfw" className="cg fu" style={{display: market === "dfw" ? "" : "none"}}>
        <div className="cp"><span className="cd"></span>Dallas</div><div className="cp"><span className="cd"></span>Fort Worth</div>
        <div className="cp"><span className="cd"></span>Arlington</div><div className="cp"><span className="cd"></span>Grand Prairie</div>
        <div className="cp"><span className="cd"></span>Irving</div><div className="cp"><span className="cd"></span>Plano</div>
        <div className="cp"><span className="cd"></span>McKinney</div><div className="cp"><span className="cd"></span>Denton</div>
        <div className="cp"><span className="cd"></span>Mansfield</div><div className="cp"><span className="cd"></span>Mesquite</div>
        <div className="cp"><span className="cd"></span>Garland</div><div className="cp"><span className="cd"></span>Midlothian</div>
        <div className="cp"><span className="cd"></span>Cedar Hill</div><div className="cp"><span className="cd"></span>Rockwall</div>
        <div className="cp"><span className="cd"></span>Cleburne</div><div className="cp"><span className="cd"></span>+28 more</div>
      </div>
      <div id="m-den" className="cg fu" style={{display: market === "den" ? "" : "none"}}>
        <div className="cp"><span className="cd"></span>Denver</div><div className="cp"><span className="cd"></span>Aurora</div>
        <div className="cp"><span className="cd"></span>Lakewood</div><div className="cp"><span className="cd"></span>Thornton</div>
        <div className="cp"><span className="cd"></span>Arvada</div><div className="cp"><span className="cd"></span>Westminster</div>
        <div className="cp"><span className="cd"></span>Centennial</div><div className="cp"><span className="cd"></span>Boulder</div>
        <div className="cp"><span className="cd"></span>Longmont</div><div className="cp"><span className="cd"></span>Broomfield</div>
        <div className="cp"><span className="cd"></span>Castle Rock</div><div className="cp"><span className="cd"></span>Parker</div>
        <div className="cp"><span className="cd"></span>Commerce City</div><div className="cp"><span className="cd"></span>Littleton</div>
        <div className="cp"><span className="cd"></span>Brighton</div><div className="cp"><span className="cd"></span>+15 more</div>
      </div>
    </div>
    <div className="cov-r fu">
      <div className="cov-r-i">
        <h3>Expanding in 2026</h3>
        <p>Same dispatch speed and driver network, coming to new markets. Fleet members get priority access to every new city before it launches.</p>
        <div className="ep">
          <span>Houston</span><span>Austin</span><span>San Antonio</span><span>Colorado Springs</span>
        </div>
      </div>
    </div>
  </div>
</div>
</section>

{/* FAQ */}
<div className="faq">
<div className="faq-in">
  <div style={{textAlign:'center'}}>
    <div className="s-tag fu">Common questions</div>
    <h2 className="s-title fu" style={{margin:'0 auto',textAlign:'center'}}>Straight answers.</h2>
  </div>
  <div className="faq-list">
    <div className={`faq-item fu ${faq === 0 ? "open" : ""}`}>
      <button className="faq-q" onClick={() => setFaq(faq === 0 ? null : 0)}>What kind of dirt do you accept at dump sites?</button>
      <div className="faq-a"><p>Clean fill dirt, clay, topsoil, sand, and most uncontaminated excavation material. If you're unsure, your dispatcher will ask for a photo and confirm whether your material qualifies before you haul.</p></div>
    </div>
    <div className={`faq-item fu ${faq === 1 ? "open" : ""}`}>
      <button className="faq-q" onClick={() => setFaq(faq === 1 ? null : 1)}>What if there's no dump site near my job?</button>
      <div className="faq-a"><p>We cover 40+ cities across DFW and Denver metro with active dump sites. If nothing is close enough, your dispatcher will find the best alternative and let you know before you commit. We don't waste your time.</p></div>
    </div>
    <div className={`faq-item fu ${faq === 2 ? "open" : ""}`}>
      <button className="faq-q" onClick={() => setFaq(faq === 2 ? null : 2)}>How does the savings guarantee work?</button>
      <div className="faq-a"><p>If you don't save more on disposal costs than your membership fee in your first month, we refund your subscription in full AND give you the next month free. We track your loads, so the math is simple.</p></div>
    </div>
    <div className={`faq-item fu ${faq === 3 ? "open" : ""}`}>
      <button className="faq-q" onClick={() => setFaq(faq === 3 ? null : 3)}>Can I cancel anytime?</button>
      <div className="faq-a"><p>Yes. Month-to-month, cancel anytime, no contracts, no cancellation fees. We keep you because the service works, not because of fine print.</p></div>
    </div>
    <div className={`faq-item fu ${faq === 4 ? "open" : ""}`}>
      <button className="faq-q" onClick={() => setFaq(faq === 4 ? null : 4)}>I'm a driver, not a contractor. Do I have to pay?</button>
      <div className="faq-a"><p>No. Drivers never pay. Our driver network is completely free. If you're a driver looking for dump sites or paid hauling work, visit our driver page or just reach out — we'll get you set up at no cost.</p></div>
    </div>
    <div className={`faq-item fu ${faq === 5 ? "open" : ""}`}>
      <button className="faq-q" onClick={() => setFaq(faq === 5 ? null : 5)}>How fast can you get trucks to my site?</button>
      <div className="faq-a"><p>Average dispatch time is under 1 hour. Members with priority access often see trucks within 30 minutes. Your dispatcher will give you a real ETA before you commit to anything.</p></div>
    </div>
  </div>
</div>
</div>

{/* FINAL CTA */}
<section className="fcta" id="cta">
<div className="dark-topo"></div>
<div className="fc-in">
  <h2 className="fu">Done calling around.<br />Done overpaying.<br />Done losing sleep.</h2>
  <p className="fu">Your first dump site is free. Reach out now — your dispatcher will match you with an approved site today. No card, no commitment.</p>
  <div className="fc-ph fu">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
    <a href="tel:+14697174225" className="fc-n">(469) 717-4225</a>
  </div>
  <div className="fc-or fu"><span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'var(--g500)',animation:'bk 2s infinite'}}></span>your dispatcher is online now — avg. response under 60 seconds</span></div>
  <a href="#membership" className="fc-btn fu">See Membership Plans →</a>
</div>
</section>

{/* FOOTER */}
<footer>
<div className="ft-in">
  <div>
    <div className="ft-b">DUMP<i>SITE</i>.IO</div>
    <p className="ft-tg">Texas and Colorado's fastest dirt logistics network. Your dedicated dispatcher handles everything.</p>
  </div>
  <div className="ft-cs">
    <div className="ft-c"><h5>Services</h5><a href="#services">Dirt Export</a><a href="#services">Dirt Import</a><a href="#services">Managed Hauling</a></div>
    <div className="ft-c"><h5>Plans</h5><a href="#membership">Pickup — $99/mo</a><a href="#membership">Tandem — $299/mo</a><a href="#membership">Fleet — $599/mo</a></div>
    <div className="ft-c"><h5>Company</h5><a href="/about">About</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></div>
    <div className="ft-c"><h5>Drivers</h5><a href="/drivers">Join Our Network</a><a href="/login">Driver Login</a></div>
  </div>
</div>
<div className="ft-bt">
  <span>&copy; 2026 DumpSite.io. All rights reserved.</span>
  <span>Dallas–Fort Worth, TX &bull; Denver, CO</span>
</div>
</footer>

{/* STICKY MOBILE CTA */}
<div className={`sticky-m ${sticky ? "show" : ""}`} id="sticky">
<div className="sticky-m-inner">
  <a href="#cta" className="sm-btn sm-primary">Free Dump Site →</a>
  <a href="#membership" className="sm-btn sm-secondary">See Plans</a>
</div>
</div>
    </>
  )
}
