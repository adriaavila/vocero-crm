import { chromium } from "playwright";
const S=process.argv[2], B="http://127.0.0.1:3314";
const br=await chromium.launch({channel:"chrome"}); const ctx=await br.newContext({viewport:{width:375,height:812}});
const r=await ctx.request.post(B+"/api/auth/sign-in/email",{data:{email:"e2e@vocero.test",password:"password-e2e-123"}});
for(const h of r.headersArray().filter(h=>h.name.toLowerCase()==="set-cookie")){const [nv]=h.value.split(";");const i=nv.indexOf("=");await ctx.addCookies([{name:nv.slice(0,i),value:nv.slice(i+1),domain:"127.0.0.1",path:"/"}]);}
const p=await ctx.newPage(); const shot=n=>p.screenshot({path:`${S}/${n}.png`});
p.on("dialog",d=>{console.log("dialog",d.message());d.dismiss()});
await p.goto(B+"/properties"); await p.waitForTimeout(2500);
await p.locator("button[aria-label^='Ver ']").nth(1).click(); await p.waitForTimeout(1500);
await p.locator("input[type=file]").setInputFiles([`${S}/photo-a.png`,`${S}/photo-b.png`]); await p.waitForTimeout(300); await shot("11-uploading-375"); await p.waitForTimeout(4000); await shot("12-photos-375");
await p.getByRole("button",{name:"Marcar como portada"}).last().click(); await p.waitForTimeout(1500); await shot("13-cover-375");
await p.getByRole("button",{name:"Eliminar foto"}).last().click(); await p.waitForTimeout(1500); await shot("14-deleted-375");
// focus ring visibility
await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); await shot("15-focus-detail-375");
await p.getByRole("button",{name:/^Archivar$/}).last().click(); await p.waitForTimeout(1500); await shot("16-after-archive-375");
await p.getByRole("button",{name:"Archivadas"}).click(); await p.waitForTimeout(1500); await shot("17-archived-375");
await p.getByRole("button",{name:"Desarchivar"}).first().click().catch(e=>console.log("noUnarch"));await p.waitForTimeout(1500); await shot("18-unarchived-375");
await br.close();
