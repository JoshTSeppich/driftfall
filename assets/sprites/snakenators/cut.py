# Original source sheets; standard-library PNG decoder, connected light-background key.
import struct,zlib,collections,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def load(path):
 b=path.read_bytes(); p=8; data=b''
 while p<len(b):
  n=struct.unpack('>I',b[p:p+4])[0]; typ=b[p+4:p+8]; val=b[p+8:p+8+n]; p+=n+12
  if typ==b'IHDR': w,h,depth,col,*_=struct.unpack('>IIBBBBB',val)
  if typ==b'IDAT': data+=val
 assert depth==8 and col in (2,6)
 c=3 if col==2 else 4; raw=zlib.decompress(data); rows=[]; prev=bytearray(w*c); p=0
 for y in range(h):
  f=raw[p]; p+=1; row=bytearray(raw[p:p+w*c]); p+=w*c
  for i in range(len(row)):
   a=row[i-c] if i>=c else 0; v=prev[i]; d=prev[i-c] if i>=c else 0
   t=a+v-d; ds=[abs(t-a),abs(t-v),abs(t-d)]; pa=[a,v,d][ds.index(min(ds))]
   row[i]=(row[i]+[0,a,v,(a+v)//2,pa][f])&255
  rows.append([tuple(row[i:i+3]) for i in range(0,len(row),c)]); prev=row
 return rows
def save(path,w,h,pixels):
 def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d))
 raw=b''.join(b'\0'+bytes(pixels[y*w*4:(y+1)*w*4]) for y in range(h))
 path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))
def inside(x,y,poly):
 hit=False; j=len(poly)-1
 for i,(a,b) in enumerate(poly):
  c,d=poly[j]
  if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a: hit=not hit
  j=i
 return hit
sheets={k:load(root/'generated'/v) for k,v in [('worker','snk-01-siphoner-drawn.png'),('army','snk-02-units-a.png')]}
# Normalised polygon boundaries separate the neighbouring figures (including Spitter's long barrel).
items=[('siphoner','worker',[(0,0),(.31,0),(.31,.54),(0,.54)]),
 ('fang','army',[(0,.25),(.15,.25),(.205,.44),(.215,.88),(0,.88)]),
 ('spitter','army',[(.145,.14),(.35,.14),(.34,.89),(.198,.89),(.201,.45),(.145,.29)]),
 ('constrictor','army',[(.35,.1),(.59,.1),(.607,.9),(.335,.9),(.335,.46)]),
 ('hisser','army',[(.587,.06),(.784,.06),(.784,.88),(.607,.9),(.595,.55)]),
 ('boomslang','army',[(.784,.15),(1,.15),(1,.9),(.784,.9)])]
for name,key,poly in items:
 src=sheets[key]; H=len(src); W=len(src[0]); poly=[(x*W,y*H) for x,y in poly]
 x0=int(min(x for x,y in poly)); y0=int(min(y for x,y in poly)); x1=int(max(x for x,y in poly)); y1=int(max(y for x,y in poly)); w=x1-x0; h=y1-y0
 rgb=[src[y+y0][x+x0] for y in range(h) for x in range(w)]
 removed=bytearray(w*h); q=collections.deque()
 for y in range(h):
  for x in range(w):
   i=y*w+x
   if x==0 or y==0 or x==w-1 or y==h-1 or not inside(x+x0,y+y0,poly): removed[i]=1; q.append(i)
 if name=="boomslang":
  j=(int(.34*H)-y0)*w+int(.925*W)-x0; removed[j]=1; q.append(j)
 while q:
  i=q.popleft(); x=i%w; y=i//w
  for j in (i-1 if x else -1,i+1 if x+1<w else -1,i-w if y else -1,i+w if y+1<h else -1):
   if j<0 or removed[j]: continue
   r,g,b=rgb[j]
   if min(r,g,b)>108 and max(r,g,b)-min(r,g,b)<48: removed[j]=1; q.append(j)
 # Keep the main connected ink silhouette; discard neighbouring figures and detached sheet marks.
 seen=bytearray(removed); groups=[]
 for start in range(w*h):
  if seen[start]: continue
  group=[]; todo=[start]; seen[start]=1
  while todo:
   i=todo.pop(); group.append(i); x=i%w; y=i//w
   for j in (i-1 if x else -1,i+1 if x+1<w else -1,i-w if y else -1,i+w if y+1<h else -1):
    if j>=0 and not seen[j]: seen[j]=1; todo.append(j)
  groups.append(group)
 kept=max(groups,key=len); removed=bytearray([1])*(w*h)
 for i in kept: removed[i]=0
 lx=min(i%w for i in kept); rx=max(i%w for i in kept)+1; ty=min(i//w for i in kept); by=max(i//w for i in kept)+1
 out=[]
 for y in range(ty,by):
  for x in range(lx,rx):
   i=y*w+x; r,g,b=rgb[i]; alpha=0 if removed[i] else 255
   if alpha and any(0<=j<w*h and removed[j] for j in (i-1,i+1,i-w,i+w)): alpha=220
   out.extend((r,g,b,alpha))
 path=Path(__file__).parent/(name+'.png'); save(path,rx-lx,by-ty,out)
 subprocess.run(['sips','--resampleHeight','512',str(path)],check=True,stdout=subprocess.DEVNULL)
