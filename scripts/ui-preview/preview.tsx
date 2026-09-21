import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../src/components/app-shell';
import { OverviewDashboard } from '../../src/components/overview/overview-dashboard';
import { AgentClient } from '../../src/components/agent/agent-client';
import { InboxClient } from '../../src/components/inbox/inbox-client';
import { PreviewRouter, usePathname } from './navigation';
import Link from './navigation';
import { accentCssVariables } from '../../src/lib/branding';
import type { ConversationDto } from '../../src/lib/types';

const now = new Date().toISOString();
const conversations: ConversationDto[] = ['María González','Carlos Rojas','Laura Méndez','Andrés Silva','Valentina Pérez','Diego Herrera'].map((name,i)=>({id:'demo-'+i,channel:'whatsapp',contact:{id:'contact-'+i,name,phone:null},stageName:i<2?'Interesado':'Nuevo',aiEnabled:i!==2,handoffAt:i===2?now:null,handoffReason:i===2?'Solicita atención del equipo':null,lastInboundAt:now,lastMessageAt:now,unreadCount:i<3?i+1:0,windowOpen:true,windowRemainingMs:60000000,preview:['¿Podemos agendar una visita?','Gracias, me funciona ese horario.','Me gustaría hablar con una persona.','¿Qué opciones tienen disponibles?','Perfecto, muchas gracias.','¿Me compartes más información?'][i]!}));
const profile = {enabled:true,name:'Allok · Asistente de ventas',tone:'Profesional, cercano y claro.',instructions:'Ayuda al cliente a encontrar la opción correcta. Haz una pregunta a la vez y ofrece el siguiente paso.',escalationRules:'Deriva al equipo cuando el cliente lo pida o no tengas información suficiente.',greeting:'¡Hola! Soy el asistente de Allok. ¿En qué puedo ayudarte?',activationEnabled:false,activationMessages:[],allowlistEnabled:false,allowedWaIds:[],aiProvider:'openai'};
const readiness = {overall:'needs_attention' as const,agentEnabled:true,steps:[{id:'whatsapp' as const,status:'complete' as const,label:'Conecta WhatsApp',detail:'Número conectado.',href:'/settings/whatsapp'},{id:'business_hours' as const,status:'complete' as const,label:'Define el horario',detail:'Horario de atención configurado.',href:'/agent'},{id:'knowledge' as const,status:'complete' as const,label:'Información del negocio',detail:'Conocimiento disponible.',href:'/agent'},{id:'simulation' as const,status:'stale' as const,label:'Prueba tu agente',detail:'Repite la evaluación después de los últimos cambios.',href:'/lab'}],latestLab:null,optional:{brandingCustomized:true,teamMemberCount:3}};
const stages=[{id:'new',name:'Nuevo',position:0,kind:'open'},{id:'interested',name:'Interesado',position:1,kind:'open'},{id:'won',name:'Cliente',position:2,kind:'won'}];
// Isolated design preview: never forward requests to the CRM or third parties.
window.fetch = async (input,init) => {
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 const json=(data:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}));
 if(init?.method && init.method!=='GET')return json({error:{message:'Vista previa: los cambios no se guardan ni se envían al CRM.'},message:'Vista previa: los cambios no se guardan.'},409);
 const p=url.pathname;
 if(p==='/api/conversations')return json({conversations});
 if(p.match(/\/conversations\/[^/]+\/messages$/)){const id=p.split('/')[3];return json({messages:[{id:'m1',conversationId:id,direction:'in',type:'text',text:'Hola, me gustaría conocer las opciones disponibles para mi negocio.',status:'read',error:null,aiGenerated:false,origin:'operator',media:null,createdAt:now},{id:'m2',conversationId:id,direction:'out',type:'text',text:'¡Hola! Claro, te ayudo. ¿Buscas responder consultas, agendar citas o ambas cosas?',status:'read',error:null,aiGenerated:true,origin:'ai',media:null,createdAt:now},{id:'m3',conversationId:id,direction:'in',type:'text',text:'Ambas. ¿Podemos agendar una visita para verlo?',status:'read',error:null,aiGenerated:false,origin:'operator',media:null,createdAt:now}]})}
 if(p.startsWith('/api/contacts/'))return json({contact:{...conversations[0]!.contact,notes:'Cliente interesado en automatizar la atención.',ficha:{Interés:'Atención y citas'}},lead:{id:'lead-demo'},stage:stages[1]});
 if(p==='/api/pipeline/stages')return json({stages});
 if(p==='/api/agent/profile')return json({profile,aiConfigured:true});
 if(p==='/api/agent/credentials')return json({credentials:null});
 if(p==='/api/kb')return json({entries:[{id:'kb1',kind:'qa',question:'¿Qué hace Allok?',answer:'Conecta WhatsApp, agentes y herramientas para atender a tus clientes.',content:null}]});
 if(p==='/api/kb/size')return json({chars:360,warnAt:12000,warning:false});
 if(p==='/api/settings/business-hours')return json({settings:{weeklyHours:{mon:[{start:'09:00',end:'18:00'}],tue:[{start:'09:00',end:'18:00'}],wed:[{start:'09:00',end:'18:00'}],thu:[{start:'09:00',end:'18:00'}],fri:[{start:'09:00',end:'18:00'}]},timezone:'America/Caracas',responseMode:'outside_hours'},canUseAllDay:true});
 if(p==='/api/readiness')return json(readiness);
 if(p==='/api/templates')return json({templates:[]});
 return json({error:{message:'Esta acción no forma parte de la vista previa.'}},404);
};
const data={summary:{unreadConversations:24,pendingHandoffs:3,activeWindows:18,agentEnabled:true},inboundTrend:[32,48,41,65,55,82,74].map((count,i)=>({date:`2026-09-${14+i}`,count})),pipeline:stages.map((s,i)=>({stageId:s.id,name:s.name,kind:s.kind as 'open'|'won',count:[24,12,6][i]!})),priorities:conversations.slice(0,3),latestLab:{score:92,delta:8,redCount:0,finishedAt:now}};
function App(){const route=usePathname();return <><div className="preview-notice"><span>VISTA PREVIA · Datos ficticios</span><span>Inicio, conversaciones y agente · sin conexión al CRM</span></div><AppShell branding={{name:'allok',accent:'#147d52',currency:'USD',favicon:null}} userName="Adrián · Demo" role="owner" theme="light" saasMode saasPlan="pro" agenda>{route==='/overview'?<OverviewDashboard data={data} readiness={readiness} billing={null} userName="Adrián" owner/>:route==='/inbox'?<InboxClient channels={['whatsapp']}/>:route==='/agent'?<AgentClient saasMode/>:<div className="p-8"><p className="kicker">Vista de diseño</p><h1 className="mt-3 text-2xl">Explora la nueva interfaz</h1><p className="my-5 text-text-2">Esta vista previa incluye Inicio, Conversaciones y Agente. Las demás secciones conservan su implementación en el CRM.</p><div className="flex flex-wrap gap-4">{[['/overview','Inicio'],['/inbox','Conversaciones'],['/agent','Agente']].map(([href,label])=><Link key={href} href={href!} className="rounded-md border px-4 py-3">{label}</Link>)}</div></div>}</AppShell></>}
const style=document.createElement('style');style.textContent=accentCssVariables('#147d52');document.head.append(style);
createRoot(document.getElementById('preview-root')!).render(<PreviewRouter><App/></PreviewRouter>);
