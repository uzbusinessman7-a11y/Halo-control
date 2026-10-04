const DEFAULT_DATA = {
  password: "BU_YERGA_QOYILADI",
  settings: {
    subtitle: "CHICKEN • KEBAB • PIZZA",
    heroBadge: "YANGI TAYYORLANDI",
    heroTitle: "Mazali. Tez. Halol.",
    heroText: "HALO bilan har bir taom — yangi taassurot."
  },
  items: [
    {id:1, category:"Chicken", name:{uz:"Crispy Chicken",ko:"크리스피 치킨",en:"Crispy Chicken"},price:15000,badge:"HOT",image:"",emoji:"🍗",soldOut:false},
    {id:2, category:"Kebab", name:{uz:"Chicken Kebab",ko:"치킨 케밥",en:"Chicken Kebab"},price:15000,badge:"NEW",image:"",emoji:"🥙",soldOut:false},
    {id:3, category:"Pizza", name:{uz:"Pepperoni Pizza",ko:"페퍼로니 피자",en:"Pepperoni Pizza"},price:15000,badge:"",image:"",emoji:"🍕",soldOut:false},
    {id:4, category:"Burger", name:{uz:"Halo Burger",ko:"할로 버거",en:"Halo Burger"},price:15000,badge:"BEST",image:"",emoji:"🍔",soldOut:false},
    {id:5, category:"Chicken", name:{uz:"Spicy Wings",ko:"매운 윙",en:"Spicy Wings"},price:15000,badge:"SPICY",image:"",emoji:"🔥",soldOut:false},
    {id:6, category:"Kebab", name:{uz:"Beef Kebab",ko:"비프 케밥",en:"Beef Kebab"},price:15000,badge:"",image:"",emoji:"🌯",soldOut:false},
    {id:7, category:"Pizza", name:{uz:"Cheese Pizza",ko:"치즈 피자",en:"Cheese Pizza"},price:15000,badge:"NEW",image:"",emoji:"🧀",soldOut:false},
    {id:8, category:"Drinks", name:{uz:"Fresh Lemonade",ko:"레모네이드",en:"Fresh Lemonade"},price:5000,badge:"",image:"",emoji:"🥤",soldOut:false}
  ]
};

let data = loadData();
let lang = localStorage.getItem("halo_lang") || "uz";
let activeCategory = "All";

function loadData(){
  try{
    const raw = localStorage.getItem("halo_menu_data");
    return raw ? JSON.parse(raw) : structuredClone(DEFAULT_DATA);
  }catch(e){ return structuredClone(DEFAULT_DATA); }
}
function saveData(){ localStorage.setItem("halo_menu_data", JSON.stringify(data)); }

function esc(s){ return String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function money(n){ return Number(n||0).toLocaleString("ko-KR")+"₩"; }

function render(){
  document.documentElement.lang = lang;
  document.getElementById("langBtn").textContent = lang.toUpperCase();
  document.getElementById("brandSubtitle").textContent = data.settings.subtitle;
  document.getElementById("heroBadge").textContent = data.settings.heroBadge;
  document.getElementById("heroTitle").textContent = data.settings.heroTitle;
  document.getElementById("heroText").textContent = data.settings.heroText;

  const cats = ["All", ...new Set(data.items.map(x=>x.category).filter(Boolean))];
  if(!cats.includes(activeCategory)) activeCategory = "All";
  document.getElementById("categoryNav").innerHTML = cats.map(c=>`<button class="category-btn ${c===activeCategory?"active":""}" data-cat="${esc(c)}">${c==="All"?(lang==="ko"?"전체":lang==="en"?"All":"Barchasi"):esc(c)}</button>`).join("");
  document.querySelectorAll(".category-btn").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.cat;render();});

  const list = data.items.filter(x=>activeCategory==="All"||x.category===activeCategory);
  document.getElementById("menuGrid").innerHTML = list.map(item=>`
    <article class="menu-card">
      ${item.badge?`<span class="badge">${esc(item.badge)}</span>`:""}
      ${item.soldOut?`<div class="soldout">${lang==="ko"?"품절":lang==="en"?"SOLD OUT":"SOTUVDA YO‘Q"}</div>`:""}
      <div class="food-image">
        ${item.image?`<img src="${esc(item.image)}" alt="${esc(item.name[lang]||item.name.uz)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'food-placeholder',textContent:'🍽️'}))">`:`<div class="food-placeholder">${esc(item.emoji||"🍽️")}</div>`}
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(item.name[lang]||item.name.uz)}</h3>
        <div class="price">${money(item.price)}</div>
      </div>
    </article>`).join("");
}

function renderAdminItems(){
  document.getElementById("adminItems").innerHTML = data.items.map(x=>`
    <div class="admin-item">
      <div><b>${esc(x.name.uz)}</b><br><small>${esc(x.category)} • ${money(x.price)} ${x.soldOut?"• SOTUVDA YO‘Q":""}</small></div>
      <button data-del="${x.id}">O‘chirish</button>
    </div>`).join("");
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
    data.items=data.items.filter(x=>x.id!==Number(b.dataset.del));saveData();render();renderAdminItems();
  });
}

document.getElementById("clock").textContent="";
setInterval(()=>document.getElementById("clock").textContent=new Date().toLocaleTimeString("uz-UZ",{hour:"2-digit",minute:"2-digit"}),1000);

document.getElementById("langBtn").onclick=()=>{
  lang = lang==="uz"?"ko":lang==="ko"?"en":"uz";
  localStorage.setItem("halo_lang",lang); render();
};
document.getElementById("adminBtn").onclick=()=>document.getElementById("adminOverlay").classList.remove("hidden");
document.getElementById("closeAdmin").onclick=()=>document.getElementById("adminOverlay").classList.add("hidden");
document.getElementById("adminOverlay").onclick=e=>{if(e.target.id==="adminOverlay")e.currentTarget.classList.add("hidden")};

document.getElementById("loginBtn").onclick=()=>{
  if(document.getElementById("passwordInput").value===data.password){
    document.getElementById("loginBox").classList.add("hidden");
    document.getElementById("adminContent").classList.remove("hidden");
    document.getElementById("setSubtitle").value=data.settings.subtitle;
    document.getElementById("setHeroBadge").value=data.settings.heroBadge;
    document.getElementById("setHeroTitle").value=data.settings.heroTitle;
    document.getElementById("setHeroText").value=data.settings.heroText;
    renderAdminItems();
  }else alert("Parol noto‘g‘ri");
};

document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  ["items","settings","security"].forEach(t=>document.getElementById(t+"Tab").classList.toggle("hidden",t!==btn.dataset.tab));
});

document.getElementById("addItemBtn").onclick=()=>{
  const uz=document.getElementById("itemNameUz").value.trim();
  if(!uz) return alert("Taom nomini yozing");
  data.items.push({
    id:Date.now(),
    category:document.getElementById("itemCategory").value.trim()||"Boshqa",
    name:{
      uz,
      ko:document.getElementById("itemNameKo").value.trim()||uz,
      en:document.getElementById("itemNameEn").value.trim()||uz
    },
    price:Number(document.getElementById("itemPrice").value)||0,
    badge:document.getElementById("itemBadge").value.trim(),
    image:document.getElementById("itemImage").value.trim(),
    emoji:"🍽️",
    soldOut:document.getElementById("itemSoldOut").checked
  });
  saveData();render();renderAdminItems();
  ["itemNameUz","itemNameKo","itemNameEn","itemPrice","itemCategory","itemBadge","itemImage"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("itemSoldOut").checked=false;
};

document.getElementById("saveSettingsBtn").onclick=()=>{
  data.settings.subtitle=document.getElementById("setSubtitle").value.trim();
  data.settings.heroBadge=document.getElementById("setHeroBadge").value.trim();
  data.settings.heroTitle=document.getElementById("setHeroTitle").value.trim();
  data.settings.heroText=document.getElementById("setHeroText").value.trim();
  saveData();render();alert("Saqlandi");
};
document.getElementById("savePasswordBtn").onclick=()=>{
  const a=document.getElementById("newPassword").value,b=document.getElementById("confirmPassword").value;
  if(a.length<4)return alert("Parol kamida 4 ta belgidan iborat bo‘lsin");
  if(a!==b)return alert("Parollar bir xil emas");
  data.password=a;saveData();alert("Parol almashtirildi");
};
document.getElementById("resetBtn").onclick=()=>{
  if(confirm("Barcha o‘zgarishlar o‘chiriladi. Davom etasizmi?")){
    data=structuredClone(DEFAULT_DATA);saveData();render();renderAdminItems();
  }
};

render();
