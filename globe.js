/* ═══════════════════════════════════════════════════
   MINI GLOBE 3D — Header
═══════════════════════════════════════════════════ */
(function(){
  if(typeof THREE === 'undefined') return;

  var canvas  = document.getElementById('globeCanvas');
  var W = 108, H = 108; /* render 2x para ser nítido no 54px */
  canvas.width  = W;
  canvas.height = H;

  var renderer = new THREE.WebGLRenderer({ canvas:canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(2);
  renderer.setSize(W, H);
  renderer.setClearColor(0x040c18, 1);

  var scene  = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.z = 2.6;

  /* ── Stars ── */
  var sGeo = new THREE.BufferGeometry();
  var sPos = new Float32Array(600 * 3);
  for(var i=0;i<600*3;i++) sPos[i]=(Math.random()-0.5)*30;
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos,3));
  scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({color:0x88aaff,size:0.05,transparent:true,opacity:0.5})));

  /* ── Globe ── */
  var R = 1.0;
  var globeMat = new THREE.ShaderMaterial({
    uniforms:{ time:{value:0} },
    vertexShader:`
      varying vec3 vN; varying vec2 vUv;
      void main(){ vN=normalize(normalMatrix*normal); vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`
      uniform float time; varying vec3 vN; varying vec2 vUv;
      float h(vec2 p){p=fract(p*vec2(234.34,435.35));p+=dot(p,p+34.2);return fract(p.x*p.y);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.;float a=0.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.;a*=.5;}return v;}
      void main(){
        /* Grid */
        float gx=smoothstep(.95,1.,fract(vUv.x*30.));
        float gy=smoothstep(.95,1.,fract(vUv.y*15.));
        float grid=max(gx,gy);
        /* Continents */
        float c=fbm(vUv*vec2(5.,2.5)+1.5);
        c=smoothstep(.47,.55,c);
        /* Cities */
        float ct=fbm(vUv*vec2(20.,10.)+time*.01);
        float city=c*smoothstep(.62,.78,ct);
        /* Base — cores claras azul planeta */
        vec3 ocean=vec3(0.05,.28,.60);
        vec3 land=vec3(0.08,.48,.32);
        vec3 col=mix(ocean,land,c);
        col+=vec3(.12,.58,.95)*grid*.20*(0.5+0.5*c);
        /* Cities */
        vec3 cc=mix(vec3(1.,.75,.2),vec3(.65,.92,1.),fract(ct*8.));
        col+=cc*city*.9;
        /* Pulse */
        col+=vec3(.12,.65,1.)*grid*(0.5+0.5*sin(time*2.-vUv.x*20.))*.10;
        /* Rim glow azul claro vivo */
        float rim=pow(1.-abs(dot(vN,vec3(0,0,1))),2.2);
        col+=vec3(.35,.78,1.)*rim*1.3;
        float fr=pow(1.-max(0.,dot(vN,vec3(0,0,1))),3.);
        col+=vec3(.25,.62,1.)*fr*.75;
        gl_FragColor=vec4(col,1.0);
      }`,
    transparent:true
  });
  var globe = new THREE.Mesh(new THREE.SphereGeometry(R,48,48), globeMat);
  scene.add(globe);

  /* ── Atmosphere ── */
  var atmMat = new THREE.ShaderMaterial({
    uniforms:{}, transparent:true, side:THREE.BackSide,
    blending:THREE.AdditiveBlending, depthWrite:false,
    vertexShader:`varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 vN;void main(){float i=pow(.55-dot(vN,vec3(0,0,1)),2.);gl_FragColor=vec4(.2,.65,1.,i*1.2);}`
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(R*1.1,24,24), atmMat));

  /* ── City dots ── */
  var cities=[
    [40.7,-74],[51.5,-0.1],[35.7,139.7],[31.2,121.5],[22.3,114.2],
    [1.3,103.8],[-23.5,-46.6],[28.6,77.2],[25.2,55.3],[-3.7,-38.5],
    [48.8,2.3],[55.7,37.6],[34,-118.2],[19.4,-99.1],[37.5,127]
  ];
  function ll(lat,lon,r){
    var phi=(90-lat)*Math.PI/180, th=(lon+180)*Math.PI/180;
    return new THREE.Vector3(-r*Math.sin(phi)*Math.cos(th),r*Math.cos(phi),r*Math.sin(phi)*Math.sin(th));
  }
  var dGeo=new THREE.SphereGeometry(.018,6,6);
  cities.forEach(function(c,i){
    var m=new THREE.Mesh(dGeo,new THREE.MeshBasicMaterial({color:i%3===0?0xffaa00:0x00ffcc}));
    m.position.copy(ll(c[0],c[1],R+.01));
    globe.add(m);
  });

  /* ── Arcs ── */
  var arcPairs=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[0,6],[1,7],[7,8],[8,9],[9,6],[0,10],[10,11],[2,12],[12,13],[3,14]];
  arcPairs.forEach(function(pair){
    var v1=ll(cities[pair[0]][0],cities[pair[0]][1],R);
    var v2=ll(cities[pair[1]][0],cities[pair[1]][1],R);
    var mid=v1.clone().add(v2).normalize().multiplyScalar(R*1.38);
    var pts=[]; var curve=new THREE.QuadraticBezierCurve3(v1,mid,v2);
    for(var i=0;i<=30;i++) pts.push(curve.getPoint(i/30));
    var geo=new THREE.BufferGeometry().setFromPoints(pts);
    var isAmber=Math.random()>.65;
    var mat=new THREE.LineBasicMaterial({color:isAmber?0xffaa00:0x0099ff,transparent:true,opacity:.3,blending:THREE.AdditiveBlending,depthWrite:false});
    scene.add(new THREE.Line(geo,mat));
  });

  /* ── Orbital ring ── */
  var rPts=[]; for(var i=0;i<=100;i++){var a=i/100*Math.PI*2;rPts.push(new THREE.Vector3(Math.cos(a)*1.18,0,Math.sin(a)*1.18));}
  var ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(rPts),new THREE.LineBasicMaterial({color:0x0066ff,transparent:true,opacity:.45,blending:THREE.AdditiveBlending,depthWrite:false}));
  ring.rotation.x=Math.PI/2.2;
  scene.add(ring);

  var ring2=new THREE.Line(new THREE.BufferGeometry().setFromPoints(rPts.map(function(p){return new THREE.Vector3(p.x*1.07,p.z,p.y);})),
    new THREE.LineBasicMaterial({color:0xffaa00,transparent:true,opacity:.2,blending:THREE.AdditiveBlending,depthWrite:false}));
  ring2.rotation.z=Math.PI/3;
  scene.add(ring2);

  /* ── Packets ── */
  var packets=[];
  arcPairs.slice(0,8).forEach(function(pair){
    var v1=ll(cities[pair[0]][0],cities[pair[0]][1],R);
    var v2=ll(cities[pair[1]][0],cities[pair[1]][1],R);
    var mid=v1.clone().add(v2).normalize().multiplyScalar(R*1.38);
    var curve=new THREE.QuadraticBezierCurve3(v1,mid,v2);
    var m=new THREE.Mesh(new THREE.SphereGeometry(.012,4,4),new THREE.MeshBasicMaterial({color:0x44eeff,transparent:true,blending:THREE.AdditiveBlending}));
    scene.add(m);
    packets.push({m:m,curve:curve,t:Math.random(),spd:.006+Math.random()*.006,ry:0,rx:0});
  });

  /* ── Mouse drag ── */
  var drag=false,lx=0,ly=0,ry=0,rx=0;
  var wrap=document.getElementById('globeWrap');
  wrap.addEventListener('mousedown',function(e){drag=true;lx=e.clientX;ly=e.clientY;});
  window.addEventListener('mouseup',function(){drag=false;});
  window.addEventListener('mousemove',function(e){if(!drag)return;ry+=(e.clientX-lx)*.008;rx+=(e.clientY-ly)*.005;lx=e.clientX;ly=e.clientY;});
  wrap.addEventListener('touchstart',function(e){drag=true;lx=e.touches[0].clientX;ly=e.touches[0].clientY;},{passive:true});
  window.addEventListener('touchend',function(){drag=false;});
  window.addEventListener('touchmove',function(e){if(!drag)return;ry+=(e.touches[0].clientX-lx)*.008;rx+=(e.touches[0].clientY-ly)*.005;lx=e.touches[0].clientX;ly=e.touches[0].clientY;});

  /* ── Animate ── */
  var t=0;
  function loop(){
    requestAnimationFrame(loop);
    t+=.008;
    if(!drag) ry+=.004;
    globe.rotation.y=ry;
    globe.rotation.x=rx*.3;
    ring.rotation.y+=.002;
    ring2.rotation.x+=.0015;
    globeMat.uniforms.time.value=t;
    packets.forEach(function(pk){
      pk.t+=pk.spd; if(pk.t>1)pk.t=0;
      var p=pk.curve.getPoint(pk.t);
      p.applyEuler(new THREE.Euler(globe.rotation.x,globe.rotation.y,0));
      pk.m.position.copy(p);
      pk.m.material.opacity=.4+.6*Math.abs(Math.sin(t*8+pk.t*15));
    });
    renderer.render(scene,camera);
  }
  loop();
})();

/* TECH GLOBE SCENE — desativado no tema light (fundo sólido claro) */
(function(){
  /* Ocultar o canvas para fundo limpo */
  var canvas = document.getElementById('spaceCanvas');
  if(canvas) canvas.style.display='none';
  return;
  if(typeof THREE === 'undefined') return;
  if(!canvas) return;

  var el = canvas.parentElement;
  var W = el.offsetWidth  || 1200;
  var H = el.offsetHeight || 520;
  canvas.width  = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  var renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, alpha:false});
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.setClearColor(0x020810, 1);

  var scene  = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 500);
  camera.position.set(0, 0, 4.2);

  /* ── Background stars ── */
  (function(){
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(2500*3);
    for(var i=0;i<2500;i++){
      var theta=Math.random()*Math.PI*2, phi=Math.acos(2*Math.random()-1), r=60+Math.random()*120;
      pos[i*3]=r*Math.sin(phi)*Math.cos(theta);
      pos[i*3+1]=r*Math.sin(phi)*Math.sin(theta);
      pos[i*3+2]=r*Math.cos(phi);
    }
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    scene.add(new THREE.Points(geo,new THREE.PointsMaterial({color:0x99bbff,size:0.18,transparent:true,opacity:0.7,blending:THREE.AdditiveBlending,depthWrite:false})));
  })();

  /* ── GLOBE ── */
  var R=1.0;
  var globeMat = new THREE.ShaderMaterial({
    uniforms:{time:{value:0}},
    vertexShader:`
      varying vec3 vN; varying vec2 vUv;
      void main(){ vN=normalize(normalMatrix*normal); vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`
      uniform float time; varying vec3 vN; varying vec2 vUv;
      /* simple hash + noise */
      float h2(vec2 p){p=fract(p*vec2(234.34,435.35));p+=dot(p,p+34.23);return fract(p.x*p.y);}
      float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.;float a=.5;for(int i=0;i<4;i++){v+=a*n2(p);p*=2.1;a*=.5;}return v;}
      void main(){
        /* lat/lon grid lines */
        float gx = smoothstep(.93,1., fract(vUv.x*36.));
        float gy = smoothstep(.93,1., fract(vUv.y*18.));
        float grid = max(gx,gy);
        /* continent mask */
        float land = fbm(vUv*vec2(4.,2.)+1.5);
        land = smoothstep(.44,.56,land);
        /* base deep ocean */
        vec3 base = vec3(0.,.04,.18);
        /* subtle land tint */
        base = mix(base, vec3(0.,.07,.28), land*.6);
        /* bright cyan grid on land, dimmer on ocean */
        float gridBright = mix(.08,.22,land);
        base += vec3(0.,.55,1.) * grid * gridBright;
        /* Pulse wave across globe */
        float wave = sin(vUv.x*20. - time*1.8)*0.5+0.5;
        base += vec3(0.,.3,.7)*grid*wave*.05;
        /* Connection node hotspots */
        float ct = fbm(vUv*vec2(18.,9.)+time*.006);
        float node = land * smoothstep(.64,.8,ct);
        vec3 nCol = mix(vec3(0.,.9,1.), vec3(.8,.5,1.), fract(ct*7.));
        base += nCol * node * 1.2;
        /* Rim light — strong cyan glow */
        float rim = pow(1.-abs(dot(vN,vec3(0,0,1))),2.2);
        base += vec3(0.,.7,1.) * rim * 1.4;
        float fr = pow(1.-max(0.,dot(vN,vec3(0,0,1))),4.);
        base += vec3(.2,.5,1.) * fr * .6;
        gl_FragColor = vec4(base,.97);
      }`,
    transparent:true
  });
  var globe = new THREE.Mesh(new THREE.SphereGeometry(R,80,80), globeMat);
  scene.add(globe);

  /* ── Inner glow shell ── */
  var innerGlow = new THREE.Mesh(new THREE.SphereGeometry(R*.98,32,32),
    new THREE.ShaderMaterial({
      uniforms:{}, transparent:true, depthWrite:false,
      blending:THREE.AdditiveBlending, side:THREE.BackSide,
      vertexShader:`void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`void main(){gl_FragColor=vec4(0.,.3,.9,.08);}`
    }));
  scene.add(innerGlow);

  /* ── Atmosphere — layered ── */
  function makeAtm(scale, col, opacity){
    return new THREE.Mesh(new THREE.SphereGeometry(R*scale,32,32), new THREE.ShaderMaterial({
      uniforms:{}, transparent:true, side:THREE.BackSide,
      blending:THREE.AdditiveBlending, depthWrite:false,
      vertexShader:`varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`varying vec3 vN;uniform vec3 c;uniform float op;
        void main(){float i=pow(.55-dot(vN,vec3(0,0,1)),2.2);gl_FragColor=vec4(${col},i*${opacity.toFixed(2)});}`,
    }));
  }
  scene.add(makeAtm(1.06,'0.,.7,1.',1.0));
  scene.add(makeAtm(1.12,'0.,.5,1.',0.6));
  scene.add(makeAtm(1.22,'0.,.3,.9',0.3));

  /* ── City nodes on surface ── */
  var cities=[
    [40.7,-74],[51.5,-0.1],[35.7,139.7],[31.2,121.5],[22.3,114.2],
    [1.3,103.8],[-23.5,-46.6],[28.6,77.2],[25.2,55.3],[48.8,2.3],
    [55.7,37.6],[34,-118.2],[37.5,127],[-33.9,18.4],[39.9,116.4],
    [13.75,100.5],[52.5,13.4],[41.,29.],[19.,-99.],[6.5,3.4]
  ];
  function ll(lat,lon,r){
    var phi=(90-lat)*Math.PI/180,th=(lon+180)*Math.PI/180;
    return new THREE.Vector3(-r*Math.sin(phi)*Math.cos(th),r*Math.cos(phi),r*Math.sin(phi)*Math.sin(th));
  }
  var dotGeo=new THREE.SphereGeometry(.018,8,8);
  var dots=[];
  cities.forEach(function(c,i){
    var col=i%3===0?0x00ffee:i%3===1?0x00aaff:0xff88ff;
    var m=new THREE.Mesh(dotGeo,new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.9,blending:THREE.AdditiveBlending}));
    m.position.copy(ll(c[0],c[1],R+.015));
    globe.add(m);
    dots.push({mesh:m, base:i});
  });

  /* ── Connection arcs between cities ── */
  var pairs=[[0,2],[2,3],[3,4],[4,5],[1,0],[1,10],[6,0],[7,14],[8,1],[9,10],[11,0],[12,3],[13,14],[15,4],[16,9],[17,8]];
  pairs.forEach(function(p){
    var v1=ll(cities[p[0]][0],cities[p[0]][1],R);
    var v2=ll(cities[p[1]][0],cities[p[1]][1],R);
    var mid=v1.clone().add(v2).normalize().multiplyScalar(R*1.45);
    var curve=new THREE.QuadraticBezierCurve3(v1,mid,v2);
    var pts=curve.getPoints(50);
    var geo=new THREE.BufferGeometry().setFromPoints(pts);
    var col=Math.random()>.5?0x00eeff:0x8844ff;
    scene.add(new THREE.Line(geo,new THREE.LineBasicMaterial({color:col,transparent:true,opacity:.4,blending:THREE.AdditiveBlending,depthWrite:false})));
  });

  /* ── Data packets travelling arcs ── */
  var packets=[];
  pairs.slice(0,10).forEach(function(p){
    var v1=ll(cities[p[0]][0],cities[p[0]][1],R);
    var v2=ll(cities[p[1]][0],cities[p[1]][1],R);
    var mid=v1.clone().add(v2).normalize().multiplyScalar(R*1.45);
    var curve=new THREE.QuadraticBezierCurve3(v1,mid,v2);
    var m=new THREE.Mesh(new THREE.SphereGeometry(.013,6,6),new THREE.MeshBasicMaterial({color:0x00ffff,transparent:true,blending:THREE.AdditiveBlending}));
    globe.add(m);
    packets.push({m:m,curve:curve,t:Math.random(),spd:.004+Math.random()*.005});
  });

  /* ── Orbital rings ── */
  function addRing(r, col, op, rx, ry, rz){
    var pts=[];
    for(var i=0;i<=128;i++){var a=i/128*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*r,0,Math.sin(a)*r));}
    var ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({color:col,transparent:true,opacity:op,blending:THREE.AdditiveBlending,depthWrite:false}));
    ring.rotation.set(rx,ry,rz);
    scene.add(ring);
    return ring;
  }
  var ring1=addRing(1.28,0x00ccff,.55,Math.PI/2.1,0,0);
  var ring2=addRing(1.40,0x0055ff,.35,Math.PI/3,0,Math.PI/6);
  var ring3=addRing(1.55,0x8800ff,.2,Math.PI/1.6,0,Math.PI/4);

  /* Floating labels removidos no tema light */

  /* ── Central energy burst ── */
  var burstMat=new THREE.ShaderMaterial({
    uniforms:{time:{value:0}},
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`
      uniform float time; varying vec2 vUv;
      void main(){
        vec2 c=vUv-0.5;
        float d=length(c);
        float r=0.5;
        float pulse=0.5+0.5*sin(time*2.);
        float glow=exp(-d*d*8.)*0.5*pulse;
        float ring1=exp(-pow(d-.25,2.)*120.)*.3;
        float ring2=exp(-pow(d-.4,2.)*200.)*.15;
        vec3 col=vec3(0.,.6,1.)*(glow+ring1+ring2);
        gl_FragColor=vec4(col, (glow+ring1+ring2)*0.9);
      }`,
  });
  var burst=new THREE.Mesh(new THREE.PlaneGeometry(2.8,2.8),burstMat);
  burst.position.z=-.5;
  scene.add(burst);

  /* ── Animate ── */
  var t=0, ry=0;
  function loop(){
    requestAnimationFrame(loop);
    t+=.008;
    ry+=.0025;
    globe.rotation.y=ry;
    globeMat.uniforms.time.value=t;
    burstMat.uniforms.time.value=t;
    starMat && (starMat.uniforms.time.value=t);
    ring1.rotation.y+=.0015;
    ring2.rotation.x+=.001;
    ring3.rotation.z+=.0008;
    /* node pulse */
    dots.forEach(function(d,i){
      d.mesh.material.opacity=0.5+0.5*Math.abs(Math.sin(t*1.5+i*.7));
      var s=0.8+0.4*Math.abs(Math.sin(t*2+i*.5));
      d.mesh.scale.setScalar(s);
    });
    /* packets */
    packets.forEach(function(pk){
      pk.t+=pk.spd; if(pk.t>1)pk.t=0;
      var p=pk.curve.getPoint(pk.t);
      pk.m.position.copy(p);
      pk.m.material.opacity=.4+.6*Math.abs(Math.sin(t*6+pk.t*12));
    });
    /* subtle camera breathe */
    camera.position.z=4.2+Math.sin(t*.3)*.08;
    camera.lookAt(0,0,0);
    renderer.render(scene,camera);
  }
  loop();

  window.addEventListener('resize',function(){
    var p=canvas.parentElement; if(!p) return;
    var nW=p.offsetWidth, nH=p.offsetHeight||520;
    renderer.setSize(nW,nH);
    camera.aspect=nW/nH; camera.updateProjectionMatrix();
  });
})();
